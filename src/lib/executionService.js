import { getExecutionMode } from "./brokerConfig";
import { evaluateRisk } from "./riskEngine";
import { PositionEngine } from "./positionEngine";
import { validateOrder } from "./orderValidation";
import { handleBrokerResponse } from "./brokerResponseHandler";
import { ExecutionLedger } from "./executionLedger";
import { ingestBrokerExecution } from "./executionIngestion";
import { RiskEventLedger, createRiskEventFromRiskEvaluation } from "./riskEvent";
import { fromEnginePosition } from "./positionPersistence";
import { recoverRiskState } from "./riskRecovery";
function positionsAgree(persisted, reconstructed) {
    if (!persisted || !reconstructed)
        return persisted === reconstructed;
    return [
        persisted.account_id === reconstructed.account_id,
        persisted.symbol === reconstructed.symbol,
        persisted.instrument_id === reconstructed.instrument_id,
        persisted.quantity === reconstructed.quantity,
        persisted.side === reconstructed.side,
        persisted.average_price === reconstructed.average_price,
        persisted.unrealized_pnl === reconstructed.unrealized_pnl,
        persisted.realized_pnl === reconstructed.realized_pnl,
        persisted.position_status === reconstructed.position_status,
    ].every(Boolean);
}
export class ExecutionService {
    constructor(router, options = {}) {
        Object.defineProperty(this, "router", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "options", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "idempotency", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "idempotencyFingerprints", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "inFlight", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "positionEngines", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "executionLedger", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new ExecutionLedger()
        });
        Object.defineProperty(this, "accountLocks", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "preTradeRiskGate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "onRiskEvent", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "riskEventLedger", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new RiskEventLedger()
        });
        Object.defineProperty(this, "canonicalState", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "recoverUncertainOrder", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "recoveredRiskStates", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "lastPositionRecovery", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                status: "MATCH",
                mismatches: [],
                persistedPositionCount: 0,
                reconstructedPositionCount: 0,
            }
        });
        this.router = router;
        this.options = {
            mode: options.mode ?? getExecutionMode(),
            realOrderEnabled: options.realOrderEnabled ?? false,
            authUserId: options.authUserId ?? "",
            accountResolver: options.accountResolver ?? null,
            brokerMappingResolver: options.brokerMappingResolver ?? null,
            riskRules: options.riskRules ?? null,
            riskState: options.riskState ?? null,
            brokerRuntime: options.brokerRuntime ?? null,
            instrumentResolver: options.instrumentResolver ?? null,
            allowedProducts: options.allowedProducts ?? [],
        };
        this.preTradeRiskGate = options.preTradeRiskGate;
        this.onRiskEvent = options.onRiskEvent;
        this.canonicalState = options.canonicalState;
        this.recoverUncertainOrder = options.recoverUncertainOrder;
    }
    async recoverFromCanonicalState(accountId, ownerUserId) {
        if (!this.canonicalState)
            throw new Error("Canonical trading state persistence is not configured");
        const loaded = await this.canonicalState.load(accountId, ownerUserId ?? this.options.authUserId);
        const orders = loaded.orders.filter((order) => (!accountId || order.accountId === accountId) && (!ownerUserId || order.ownerUserId === ownerUserId));
        const orderIds = new Set(orders.map((order) => order.id));
        const executions = loaded.executions
            .filter((execution) => orderIds.has(execution.orderId) && (!accountId || execution.accountId === accountId) && (!ownerUserId || execution.ownerUserId === ownerUserId))
            .sort((left, right) => left.executedAt.localeCompare(right.executedAt) || left.id.localeCompare(right.id));
        this.idempotency.clear();
        this.idempotencyFingerprints.clear();
        this.positionEngines.clear();
        this.executionLedger.restore(orders, executions);
        for (const execution of executions) {
            const engine = this.positionEngines.get(execution.accountId) ?? new PositionEngine(execution.accountId);
            this.positionEngines.set(execution.accountId, engine);
            engine.applyCanonicalExecution(execution);
        }
        for (const persistedPosition of loaded.positions) {
            if (persistedPosition.last_price == null)
                continue;
            const engine = this.positionEngines.get(persistedPosition.account_id);
            if (!engine)
                continue;
            engine.valueMarketPrice({
                instrumentKey: persistedPosition.instrument_id ?? persistedPosition.symbol,
                symbol: persistedPosition.symbol,
                price: persistedPosition.last_price,
                asOf: persistedPosition.updated_at,
                staleAfterMs: Number.MAX_SAFE_INTEGER,
                preserveUpdatedAt: true,
            });
        }
        const persistedPositions = loaded.positions.filter((position) => (!accountId || position.account_id === accountId) &&
            (!ownerUserId || position.owner_user_id === ownerUserId) &&
            (position.position_status === "open" || position.quantity > 0));
        const reconstructedPositions = this.reconstructPositions(loaded.positions, executions, accountId, ownerUserId);
        this.lastPositionRecovery = this.compareRecoveredPositions(persistedPositions, reconstructedPositions);
        for (const order of orders) {
            if (order.clientOrderId) {
                this.idempotencyFingerprints.set(order.clientOrderId, order.idempotencyFingerprint ?? this.fingerprintFromOrder(order));
                this.idempotency.set(order.clientOrderId, this.receiptFromOrder(order));
            }
            if (["pending", "open", "cancel_requested"].includes(order.status) && this.recoverUncertainOrder) {
                await this.recoverUncertainOrder(order, { accountId: order.accountId, ownerUserId: order.ownerUserId, reason: "restart" });
            }
        }
        const accounts = new Set(orders.map((order) => order.accountId));
        for (const recoveredAccountId of accounts) {
            const accountRiskState = this.options.riskState;
            const rules = this.options.riskRules;
            const engine = this.positionEngines.get(recoveredAccountId);
            if (!accountRiskState || !rules || !engine)
                continue;
            const valuation = engine.accountValuation(accountRiskState.current_balance);
            const latestExecution = executions.filter((execution) => execution.accountId === recoveredAccountId).at(-1);
            const recovered = recoverRiskState({ accountId: recoveredAccountId, accountState: accountRiskState, rules, valuation, positions: engine.riskSnapshot(), asOf: latestExecution ? new Date(latestExecution.executedAt) : new Date(0) });
            this.recoveredRiskStates.set(recoveredAccountId, recovered);
            const recordedRiskEvent = recovered.riskEvent ? this.riskEventLedger.recordRiskEvent(recovered.riskEvent) : null;
            if (recovered.riskEvent && !recordedRiskEvent?.replayed)
                this.onRiskEvent?.({ accountId: recoveredAccountId, decision: "REJECT", reasonCode: recovered.breachReasonCode, reason: recovered.riskEvent.reason, timestamp: recovered.riskEvent.occurredAt, riskEvent: recordedRiskEvent?.event ?? recovered.riskEvent });
        }
        const state = { ...this.exportCanonicalState(), positions: reconstructedPositions };
        if (this.lastPositionRecovery.status === "MATCH" || persistedPositions.length === 0)
            await this.canonicalState.save(state);
        return state;
    }
    getRecoveredRiskState(accountId) {
        return this.recoveredRiskStates.get(accountId) ?? null;
    }
    getLastPositionRecovery() {
        return {
            ...this.lastPositionRecovery,
            mismatches: this.lastPositionRecovery.mismatches.map((mismatch) => ({ ...mismatch })),
        };
    }
    getRecoveredAccountValuation(accountId, balance) {
        return this.positionEngines.get(accountId)?.accountValuation(balance) ?? null;
    }
    reconstructPositions(persistedPositions, executions, accountId, ownerUserId) {
        const persistedBySymbol = new Map(persistedPositions.map((position) => [`${position.account_id}:${position.symbol}`, position]));
        return [...this.positionEngines.entries()].flatMap(([currentAccountId, engine]) => engine.getPositions().map((position) => {
            const matchingExecution = executions.find((execution) => execution.accountId === currentAccountId && (execution.instrumentId ?? execution.symbol) === position.instrumentKey && execution.symbol === position.symbol);
            const persisted = persistedBySymbol.get(`${currentAccountId}:${position.symbol}`);
            const owner = persisted?.owner_user_id ?? matchingExecution?.ownerUserId ?? ownerUserId ?? "recovered";
            const reconstructed = fromEnginePosition(position, owner, { accountId: currentAccountId, ownerUserId: owner, instrumentId: matchingExecution?.instrumentId ?? null });
            return persisted ? { ...reconstructed, id: persisted.id } : reconstructed;
        })).filter((position) => !accountId || position.account_id === accountId);
    }
    compareRecoveredPositions(persistedPositions, reconstructedPositions) {
        if (persistedPositions.length === 0) {
            return { status: "MATCH", mismatches: [], persistedPositionCount: 0, reconstructedPositionCount: reconstructedPositions.length };
        }
        const persistedByKey = new Map(persistedPositions.map((position) => [`${position.account_id}:${position.symbol}`, position]));
        const reconstructedByKey = new Map(reconstructedPositions.map((position) => [`${position.account_id}:${position.symbol}`, position]));
        const keys = [...new Set([...persistedByKey.keys(), ...reconstructedByKey.keys()])].sort();
        const mismatches = keys.flatMap((key) => {
            const persisted = persistedByKey.get(key) ?? null;
            const reconstructed = reconstructedByKey.get(key) ?? null;
            if (positionsAgree(persisted, reconstructed))
                return [];
            return [{ accountId: reconstructed?.account_id ?? persisted?.account_id ?? "", symbol: reconstructed?.symbol ?? persisted?.symbol ?? "", persisted, reconstructed }];
        });
        return {
            status: mismatches.length === 0 ? "MATCH" : "MISMATCH",
            mismatches,
            persistedPositionCount: persistedPositions.length,
            reconstructedPositionCount: reconstructedPositions.length,
        };
    }
    exportCanonicalState() {
        const positions = [...this.positionEngines.entries()].flatMap(([accountId, engine]) => {
            const ownerUserId = this.executionLedger.getOrders().find((order) => order.accountId === accountId)?.ownerUserId ?? "recovered";
            return engine.getPositions().map((position) => fromEnginePosition(position, ownerUserId, { accountId, ownerUserId }));
        });
        return { orders: this.executionLedger.getOrders(), executions: this.executionLedger.getExecutions(), positions };
    }
    getPositions(accountId) {
        return this.positionEngines.get(accountId)?.getPositions() ?? [];
    }
    getAccountValuation(accountId, balance) {
        return this.positionEngines.get(accountId)?.accountValuation(balance) ?? {
            accountId,
            balance,
            equity: balance,
            realizedPnl: 0,
            unrealizedPnl: 0,
            fees: 0,
            exposure: 0,
            openPositionCount: 0,
            marketDataStatus: "VALUED",
        };
    }
    fingerprintFromOrder(order) {
        return JSON.stringify([order.accountId, order.symbol, order.exchange, order.segment, order.side, order.quantity, order.orderType, order.price, order.triggerPrice, order.timeInForce, order.stopLoss, order.takeProfit, order.instrumentId]);
    }
    receiptFromOrder(order) {
        return {
            state: order.status === "rejected" ? "REJECTED" : order.status === "pending" || order.status === "open" || order.status === "partially_filled" ? "PENDING" : "REAL",
            reasonCode: order.rejectionReason,
            reason: "Recovered from canonical trading state",
            replay: true,
            orderId: order.id,
            brokerOrderId: order.brokerOrderId ?? `pending:${order.clientOrderId ?? order.id}`,
            accountId: order.accountId,
            brokerId: "dhan",
            symbol: order.symbol,
            side: order.side,
            quantity: order.quantity,
            executedAt: order.createdAt,
            executionMode: this.options.mode,
            canonicalOrder: order,
        };
    }
    async persistCanonicalState() {
        if (this.canonicalState)
            await this.canonicalState.save(this.exportCanonicalState());
    }
    async syncBrokerOrder(brokerOrderId, accountId, authUserId) {
        if (!this.options.brokerRuntime || !brokerOrderId || !accountId || !authUserId) {
            return { status: "UNKNOWN", position: null, pnl: 0, reconciled: false, fills: [] };
        }
        const status = await this.options.brokerRuntime.getBrokerOrderStatus(brokerOrderId, accountId, authUserId);
        const fills = status?.fills ?? [];
        const receipt = [...this.idempotency.values()].find((candidate) => candidate.brokerOrderId === brokerOrderId && candidate.accountId === accountId);
        if (receipt?.canonicalOrder?.ownerUserId === authUserId && !this.executionLedger.getOrder(receipt.canonicalOrder.id)) {
            this.executionLedger.registerOrder(receipt.canonicalOrder);
        }
        const engine = this.positionEngines.get(accountId) ?? new PositionEngine(accountId);
        this.positionEngines.set(accountId, engine);
        for (const fill of fills) {
            const normalized = this.options.brokerRuntime.normalizeBrokerExecution(fill);
            if (receipt?.canonicalOrder?.ownerUserId === authUserId) {
                const thisLedger = this.executionLedger;
                const ingested = await ingestBrokerExecution({
                    ...normalized,
                    localOrderId: receipt.canonicalOrder.id,
                    brokerOrderId: normalized.brokerOrderId || brokerOrderId,
                    ownerUserId: authUserId,
                }, { authUserId, source: "broker" }, {
                    async persistExecution(input) {
                        const result = thisLedger.recordExecution(input);
                        return { execution: result.execution, replayed: result.replayed };
                    },
                });
                const updatedOrder = this.executionLedger.getOrder(ingested.execution.orderId);
                if (updatedOrder)
                    this.executionLedger.registerOrder(updatedOrder);
                if (ingested.replayed)
                    continue;
            }
            else {
                continue;
            }
            engine.applyExecution({
                id: normalized.brokerExecutionId,
                accountId,
                symbol: normalized.symbol,
                side: normalized.side,
                quantity: normalized.quantity,
                price: normalized.price,
                fees: normalized.fees ?? 0,
                executedAt: normalized.executedAt,
            });
        }
        await this.persistCanonicalState();
        const position = engine.getPositions().find((entry) => entry.quantity > 0) ?? null;
        const pnl = position ? Number(position.totalPnl ?? (position.realizedPnl + (position.unrealizedPnl ?? 0) - position.fees)) : 0;
        return {
            status: status?.status ?? "UNKNOWN",
            position: position ? {
                quantity: position.quantity,
                symbol: position.symbol,
                side: position.side,
                averageEntryPrice: position.averageEntryPrice,
            } : null,
            pnl,
            reconciled: Boolean(status && fills.length > 0),
            fills,
        };
    }
    async resolveRealExecutionContext(request) {
        const authUserId = request.authUserId ?? this.options.authUserId;
        if (!authUserId) {
            return this.reject(request, "UNAUTHORIZED_USER", "Authenticated user is required for real execution", `${request.accountId}:${request.brokerId}:${request.symbol}`, false, request.now ?? new Date());
        }
        const accountResolver = this.options.accountResolver ?? (this.options.brokerRuntime ? ((accountId, userId) => this.options.brokerRuntime.getBrokerAccount(accountId, userId ?? authUserId)) : null);
        const account = accountResolver ? await accountResolver(request.accountId, authUserId) : null;
        if (!account) {
            return this.reject(request, "INVALID_ACCOUNT", `No active trading account found for ${request.accountId}`, `${request.accountId}:${request.brokerId}:${request.symbol}`, false, request.now ?? new Date());
        }
        if (account.ownerUserId !== authUserId) {
            return this.reject(request, "UNAUTHORIZED_USER", "Authenticated user does not own the trading account", `${request.accountId}:${request.brokerId}:${request.symbol}`, false, request.now ?? new Date());
        }
        if (account.status !== "ACTIVE" || account.isActive === false) {
            return this.reject(request, "ACCOUNT_NOT_ACTIVE", `Trading account ${request.accountId} is not active`, `${request.accountId}:${request.brokerId}:${request.symbol}`, false, request.now ?? new Date());
        }
        const mappingResolver = this.options.brokerMappingResolver ?? (this.options.brokerRuntime ? ((accountId, userId) => Promise.resolve({
            id: `${userId ?? authUserId}:${accountId}:${request.brokerId}`,
            accountId,
            ownerUserId: userId ?? authUserId,
            brokerProvider: request.brokerId,
            brokerAccountRef: account.brokerAccountRef,
            enabled: true,
            active: true,
        })) : null);
        const mapping = mappingResolver ? await mappingResolver(request.accountId, authUserId) : null;
        if (!mapping) {
            return this.reject(request, "BROKER_MAPPING_MISSING", `No broker mapping found for account ${request.accountId}`, `${request.accountId}:${request.brokerId}:${request.symbol}`, false, request.now ?? new Date());
        }
        if (mapping.accountId !== request.accountId || mapping.ownerUserId !== authUserId || mapping.brokerProvider !== request.brokerId) {
            return this.reject(request, "BROKER_MAPPING_MISMATCH", "Broker account mapping does not match the authenticated request", `${request.accountId}:${request.brokerId}:${request.symbol}`, false, request.now ?? new Date());
        }
        if (!mapping.enabled || !mapping.active) {
            return this.reject(request, "BROKER_ACCOUNT_DISABLED", "Broker account mapping is disabled or inactive", `${request.accountId}:${request.brokerId}:${request.symbol}`, false, request.now ?? new Date());
        }
        if (this.options.brokerRuntime) {
            const sessionValid = await this.options.brokerRuntime.validateBrokerSession(request.brokerId, mapping.brokerAccountRef, authUserId);
            if (!sessionValid) {
                return this.reject(request, "BROKER_SESSION_INVALID", "Broker session is not valid for the authenticated account", `${request.accountId}:${request.brokerId}:${request.symbol}`, false, request.now ?? new Date());
            }
        }
        return { account, mapping };
    }
    async placeOrder(request) {
        const idempotencyKey = request.idempotencyKey ?? `${request.accountId}:${request.brokerId}:${request.symbol}:${request.side}:${request.quantity}:${request.orderType}`;
        const fingerprint = this.requestFingerprint(request);
        const previousFingerprint = this.idempotencyFingerprints.get(idempotencyKey);
        if (previousFingerprint && previousFingerprint !== fingerprint) {
            return this.reject(request, "IDEMPOTENCY_KEY_CONFLICT", "Idempotency key was already used for a different order request", idempotencyKey, true, request.now ?? new Date());
        }
        this.idempotencyFingerprints.set(idempotencyKey, fingerprint);
        const existing = this.idempotency.get(idempotencyKey);
        if (existing)
            return { ...existing, replay: true };
        const pending = this.inFlight.get(idempotencyKey);
        if (pending)
            return { ...(await pending), replay: true };
        const previous = this.accountLocks.get(request.accountId) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => { release = resolve; });
        const operation = (async () => {
            this.accountLocks.set(request.accountId, previous.then(() => current));
            await previous;
            try {
                return await this.placeOrderSerialized(request);
            }
            finally {
                release();
                if (this.accountLocks.get(request.accountId) === current)
                    this.accountLocks.delete(request.accountId);
            }
        })();
        this.inFlight.set(idempotencyKey, operation);
        try {
            return await operation;
        }
        finally {
            if (this.inFlight.get(idempotencyKey) === operation)
                this.inFlight.delete(idempotencyKey);
        }
    }
    async placeOrderSerialized(request) {
        const now = request.now ?? new Date();
        const idempotencyKey = request.idempotencyKey ?? `${request.accountId}:${request.brokerId}:${request.symbol}:${request.side}:${request.quantity}:${request.orderType}`;
        const fingerprint = this.requestFingerprint(request);
        const existing = this.idempotency.get(idempotencyKey);
        if (existing) {
            return { ...existing, replay: true };
        }
        if (!request.accountId) {
            return this.reject(request, "INVALID_ACCOUNT", "accountId is required", idempotencyKey, false, now);
        }
        const accountResolver = this.options.accountResolver ?? (this.options.brokerRuntime ? ((accountId, userId) => this.options.brokerRuntime.getBrokerAccount(accountId, userId ?? this.options.authUserId)) : null);
        const mode = this.options.mode ?? getExecutionMode();
        if (mode === "REAL" && !this.options.realOrderEnabled) {
            return this.reject(request, "REAL_EXECUTION_DISABLED", "Real execution is disabled until explicit broker gate approval is set", idempotencyKey, false, now);
        }
        const account = mode === "REAL" && accountResolver ? await accountResolver(request.accountId, request.authUserId ?? this.options.authUserId) : null;
        const instrument = this.options.instrumentResolver ? await this.options.instrumentResolver(request) : null;
        const validation = validateOrder({
            id: `order:${request.accountId}:${idempotencyKey}`,
            accountId: request.accountId,
            authUserId: request.authUserId ?? this.options.authUserId,
            ownerUserId: request.ownerUserId,
            symbol: request.symbol,
            exchange: request.exchange,
            side: request.side,
            quantity: request.quantity,
            orderType: request.orderType,
            price: request.price,
            triggerPrice: request.triggerPrice,
            stopLoss: request.stopLoss,
            takeProfit: request.takeProfit,
            timeInForce: request.timeInForce,
            instrumentId: request.instrumentId,
            segment: request.segment,
            product: request.product,
        }, { account, instrument, requireAccount: mode === "REAL" && Boolean(accountResolver), requireInstrument: mode === "REAL" && Boolean(this.options.instrumentResolver), allowedProducts: this.options.allowedProducts.length > 0 ? this.options.allowedProducts : undefined });
        if (validation.ok === false)
            return this.reject(request, validation.error.code, validation.error.message, idempotencyKey, false, now);
        const riskRequest = {
            account_id: request.accountId,
            symbol: request.symbol,
            segment: request.segment ?? request.exchange,
            side: request.side,
            quantity: request.quantity,
            order_type: request.orderType,
            requested_price: request.price ?? null,
            estimated_loss: request.price == null ? null : request.quantity * request.price * 0.01,
            is_overnight: request.isOvernight ?? false,
            now,
        };
        let riskEvaluation = this.preTradeRiskGate
            ? await this.preTradeRiskGate(riskRequest)
            : this.options.riskRules && this.options.riskState
                ? evaluateRisk(riskRequest, this.options.riskState, this.options.riskRules)
                : null;
        if (riskEvaluation == null) {
            if (mode === "SIMULATED") {
                riskEvaluation = {
                    decision: "ALLOW",
                    reason_code: null,
                    reason: "Simulation mode uses the canonical risk path when configured and otherwise defaults to the project’s permissive local simulation behavior",
                    account_id: request.accountId,
                    rule_evaluated: "simulated_mode",
                    current_value: null,
                    configured_limit: null,
                    risk_state: this.options.riskState?.risk_state ?? "ACTIVE",
                    timestamp: now.toISOString(),
                };
            }
            else {
                return this.reject(request, "RISK_GATE_UNAVAILABLE", "Authoritative pre-trade risk gate is unavailable", idempotencyKey, false, now);
            }
        }
        const riskDecision = riskEvaluation.decision;
        const riskEvent = createRiskEventFromRiskEvaluation(riskEvaluation, { source: "execution_service", metadata: { idempotencyKey, symbol: request.symbol, segment: request.segment, side: request.side, quantity: request.quantity } });
        const recordedRiskEvent = riskEvent ? this.riskEventLedger.recordRiskEvent(riskEvent) : null;
        this.onRiskEvent?.({
            accountId: request.accountId,
            decision: riskDecision,
            reasonCode: riskEvaluation.reason_code,
            reason: riskEvaluation.reason,
            timestamp: riskEvaluation.timestamp,
            riskEvent: recordedRiskEvent?.event ?? riskEvent,
        });
        if (riskDecision === "REJECT") {
            return this.reject(request, riskEvaluation.reason_code ?? "RISK_REJECTED", riskEvaluation.reason, idempotencyKey, false, now, riskEvaluation);
        }
        const brokerAdapter = this.router.getAdapter(request.brokerId);
        if (!brokerAdapter && !this.options.brokerRuntime) {
            return this.reject(request, "BROKER_NOT_AVAILABLE", `No broker adapter is configured for ${request.brokerId}`, idempotencyKey, false, now);
        }
        const pendingCanonicalOrder = {
            ...validation.order,
            clientOrderId: idempotencyKey,
            idempotencyFingerprint: fingerprint,
            status: "pending",
            submittedAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
        this.executionLedger.registerOrder(pendingCanonicalOrder);
        await this.persistCanonicalState();
        if (mode === "REAL") {
            const realContext = await this.resolveRealExecutionContext(request);
            if ("state" in realContext) {
                return realContext;
            }
            let adapterResult;
            try {
                adapterResult = this.options.brokerRuntime
                    ? await this.options.brokerRuntime.placeBrokerOrder({
                        accountId: request.accountId,
                        authUserId: request.authUserId ?? this.options.authUserId,
                        brokerId: request.brokerId,
                        symbol: request.symbol,
                        exchange: request.exchange,
                        side: request.side,
                        quantity: request.quantity,
                        orderType: request.orderType,
                        price: request.price,
                        stopLoss: request.stopLoss,
                        takeProfit: request.takeProfit,
                        clientOrderId: idempotencyKey,
                    })
                    : await brokerAdapter.placeOrder({
                        accountId: request.accountId,
                        ownerUserId: request.ownerUserId ?? request.authUserId ?? this.options.authUserId,
                        symbol: request.symbol,
                        exchange: request.exchange,
                        side: request.side,
                        quantity: request.quantity,
                        orderType: request.orderType,
                        price: request.price,
                        stopLoss: request.stopLoss,
                        takeProfit: request.takeProfit,
                        idempotencyKey,
                    });
            }
            catch (error) {
                adapterResult = { state: "transport_error", message: error instanceof Error ? error.message : "Broker transport failed" };
            }
            const brokerResponse = handleBrokerResponse(validation.order, adapterResult, {
                accountId: request.accountId,
                authUserId: request.authUserId ?? this.options.authUserId,
                expectedOrderId: validation.order.id,
                expectedClientOrderId: idempotencyKey,
            });
            if ("error" in brokerResponse) {
                return this.reject(request, brokerResponse.error.code, brokerResponse.error.message, idempotencyKey, false, now);
            }
            const realOrderId = brokerResponse.order.brokerOrderId ?? `pending:${idempotencyKey}`;
            const canonicalOrder = { ...brokerResponse.order, clientOrderId: idempotencyKey, idempotencyFingerprint: fingerprint };
            const receipt = {
                state: brokerResponse.response.outcome === "rejected" ? "REJECTED" : brokerResponse.response.outcome === "accepted" ? "REAL" : "PENDING",
                reasonCode: brokerResponse.response.outcome === "rejected" ? "BROKER_REJECTED" : null,
                reason: brokerResponse.response.brokerMessage ?? "Broker response normalized through the canonical order state machine",
                replay: false,
                orderId: brokerResponse.order.id,
                brokerOrderId: realOrderId,
                accountId: request.accountId,
                brokerId: request.brokerId,
                symbol: request.symbol,
                side: request.side,
                quantity: request.quantity,
                executedAt: now.toISOString(),
                executionMode: "REAL",
                riskEvaluation: null,
                canonicalOrder,
            };
            this.idempotency.set(idempotencyKey, receipt);
            this.executionLedger.registerOrder(canonicalOrder);
            await this.persistCanonicalState();
            return receipt;
        }
        const simulatedOrderId = `sim:${request.accountId}:${request.brokerId}:${idempotencyKey}`;
        const receipt = {
            state: "SIMULATED",
            reasonCode: null,
            reason: "Broker execution is simulated in this terminal",
            replay: false,
            orderId: `order:${request.accountId}:${simulatedOrderId}`,
            brokerOrderId: simulatedOrderId,
            accountId: request.accountId,
            brokerId: request.brokerId,
            symbol: request.symbol,
            side: request.side,
            quantity: request.quantity,
            executedAt: now.toISOString(),
            executionMode: "SIMULATED",
            riskEvaluation: null,
            canonicalOrder: {
                ...validation.order,
                clientOrderId: idempotencyKey,
                idempotencyFingerprint: fingerprint,
                brokerOrderId: simulatedOrderId,
                status: "pending",
                submittedAt: now.toISOString(),
                updatedAt: now.toISOString(),
            },
        };
        this.idempotency.set(idempotencyKey, receipt);
        this.executionLedger.registerOrder(receipt.canonicalOrder);
        await this.persistCanonicalState();
        return receipt;
    }
    requestFingerprint(request) {
        return JSON.stringify([
            request.accountId,
            request.brokerId,
            request.symbol.trim().toUpperCase(),
            request.exchange.trim().toUpperCase(),
            request.segment?.trim().toUpperCase() ?? null,
            request.side,
            request.quantity,
            request.orderType.trim().toUpperCase().replace(/[-_ ]/g, "-"),
            request.price ?? null,
            request.triggerPrice ?? null,
            request.timeInForce ?? null,
            request.stopLoss ?? null,
            request.takeProfit ?? null,
            request.instrumentId ?? null,
            request.product ?? null,
            request.isOvernight ?? false,
        ]);
    }
    reject(request, reasonCode, reason, idempotencyKey, replay, now, riskEvaluation) {
        const receipt = {
            state: "REJECTED",
            reasonCode,
            reason,
            replay,
            orderId: `order:${request.accountId}:rejected:${idempotencyKey}`,
            brokerOrderId: `rejected:${idempotencyKey}`,
            accountId: request.accountId,
            brokerId: request.brokerId,
            symbol: request.symbol,
            side: request.side,
            quantity: request.quantity,
            executedAt: now.toISOString(),
            executionMode: this.options.mode ?? getExecutionMode(),
            riskEvaluation: riskEvaluation ?? null,
        };
        this.idempotency.set(idempotencyKey, receipt);
        this.idempotencyFingerprints.set(idempotencyKey, this.requestFingerprint(request));
        return receipt;
    }
}
