import { timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 16384;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status, body) {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function equalSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function validateSource(source) {
  if (!source || typeof source !== "object") throw Object.assign(new Error("Verified source account data is required."), { status: 400 });
  const { account, challenge, customer, provisioning } = source;
  if (!UUID_PATTERN.test(account?.id ?? "") || !account?.accountCode ||
      !UUID_PATTERN.test(challenge?.id ?? "") || !UUID_PATTERN.test(customer?.id ?? "") ||
      !EMAIL_PATTERN.test(customer?.email ?? "") || !account?.accountCode ||
      typeof account.balance !== "number" || !Number.isFinite(account.balance) ||
      provisioning?.status !== "completed" ||
      provisioning?.tradingAccountId !== account.id || provisioning?.challengeAccountId !== challenge.id ||
      (provisioning?.traderId && provisioning.traderId !== account.traderId) ||
      account.traderId !== challenge.traderId || account.status !== "active" ||
      challenge.status !== "active") {
    throw Object.assign(new Error("The FundedWealth account, owner, active challenge, and completed provisioning record do not agree."), { status: 409 });
  }

  for (const value of [
    challenge.initialBalance,
    challenge.currentBalance,
    challenge.peakBalance,
    challenge.profitTargetPct,
    challenge.dailyLossLimitPct,
    challenge.maxDrawdownPct,
    challenge.minTradingDays,
  ]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw Object.assign(new Error("The verified account rules or balances are invalid."), { status: 409 });
    }
  }

  if (challenge.initialBalance <= 0 || challenge.minTradingDays % 1 !== 0 ||
      account.balance !== challenge.currentBalance) {
    throw Object.assign(new Error("The verified account rules or balances are invalid."), { status: 409 });
  }

  return {
    ...source,
    customer: { ...customer, email: customer.email.trim().toLowerCase() },
  };
}

export function canonicalFundedWealthProductCode(plan) {
  const normalizedPlan = plan.trim().toUpperCase();
  const stepMatch = normalizedPlan.match(/(?:^|[^A-Z0-9])([12])[-_\s]*STEP(?:$|[^A-Z0-9])/);
  if (stepMatch) return `${stepMatch[1]}-STEP`;
  return normalizedPlan.replace(/\s+/g, "");
}

export function isCompatibleFundedWealthRuleVersion(ruleVersion, source, phaseCode) {
  const ruleSetKey = phaseCode === "FUNDED" ? "funded_rules" : "evaluation_rules";
  const planRules = ruleVersion?.rules?.[ruleSetKey];
  if (!planRules) return false;
  const minTradingDays = planRules.minimum_trading_days ?? planRules.min_trading_days;
  return Number(planRules.max_drawdown_percent) === source.challenge.maxDrawdownPct &&
    Number(planRules.daily_drawdown_percent) === source.challenge.dailyLossLimitPct &&
    Number(planRules.profit_target_percent) === source.challenge.profitTargetPct &&
    Number(minTradingDays) === source.challenge.minTradingDays &&
    Number.isFinite(Number(planRules.max_risk_per_trade_percent)) &&
    Number(planRules.max_risk_per_trade_percent) > 0;
}

function makeSupabaseStore({ fetchImpl, env }) {
  const baseUrl = env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SECRET_KEY;

  async function request(path, init = {}) {
    if (!baseUrl || !serviceKey) {
      throw Object.assign(new Error("Terminal account-link service is not configured."), { status: 503 });
    }

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          apikey: serviceKey,
          ...(serviceKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${serviceKey}` }),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw Object.assign(new Error("Terminal account-link database request failed."), { status: 503 });
    }

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw Object.assign(new Error("Terminal account-link database returned an invalid response."), { status: 502 });
    }
    if (!response.ok) {
      const error = new Error("Terminal account-link database request failed.");
      error.status = response.status === 409 ? 409 : 502;
      error.database = {
        endpoint: path.split("?")[0],
        status: response.status,
        code: typeof body?.code === "string" && /^[A-Z0-9]{5}$/.test(body.code) ? body.code : undefined,
      };
      throw error;
    }
    return body;
  }

  async function rows(table, query) {
    const result = await request(`/rest/v1/${table}?${query}`);
    if (!Array.isArray(result)) throw Object.assign(new Error("Terminal account-link lookup returned an invalid result."), { status: 502 });
    return result;
  }

  async function findIdentity(email) {
    const wanted = email.toLowerCase();
    const perPage = 100;
    for (let page = 1; page <= 100; page += 1) {
      const result = await request(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`);
      const users = Array.isArray(result) ? result : result?.users;
      if (!Array.isArray(users)) throw Object.assign(new Error("Terminal identity lookup returned an invalid result."), { status: 502 });
      const matches = users.filter((user) => user.email?.toLowerCase() === wanted);
      if (matches.length > 1) throw Object.assign(new Error("More than one terminal identity matches this customer."), { status: 409 });
      if (matches.length === 1) return matches[0];
      if (users.length < perPage) return null;
    }
    throw Object.assign(new Error("Terminal identity lookup exceeded its safe pagination limit."), { status: 503 });
  }

  async function findAccounts(externalAccountId, accountCode) {
    const byExternalId = await rows("trading_accounts", new URLSearchParams({
      select: "id,owner_user_id,external_account_id,account_code,account_type,status,is_active,starting_balance,current_balance,equity,peak_equity,daily_loss_limit,maximum_drawdown,drawdown_percentage,profit_target,product_id,phase_id,rule_version_id",
      external_account_id: `eq.${externalAccountId}`,
      limit: "3",
    }));
    const byCode = await rows("trading_accounts", new URLSearchParams({
      select: "id,owner_user_id,external_account_id,account_code,account_type,status,is_active,starting_balance,current_balance,equity,peak_equity,daily_loss_limit,maximum_drawdown,drawdown_percentage,profit_target,product_id,phase_id,rule_version_id",
      account_code: `eq.${accountCode}`,
      limit: "3",
    }));
    return { byExternalId, byCode };
  }

  async function inspect(source) {
    const [identity, accounts] = await Promise.all([
      findIdentity(source.customer.email),
      findAccounts(source.account.id, source.account.accountCode),
    ]);

    if (accounts.byExternalId.length > 1) {
      throw Object.assign(new Error("Multiple terminal accounts already use this FundedWealth account identifier."), { status: 409 });
    }
    if (accounts.byCode.length > 1) {
      throw Object.assign(new Error("Multiple terminal accounts already use this account code."), { status: 409 });
    }

    const existing = accounts.byExternalId[0] ?? null;
    if (existing && (!identity || existing.owner_user_id !== identity.id ||
        existing.account_code !== source.account.accountCode ||
        existing.status !== "active" || existing.is_active !== true)) {
      throw Object.assign(new Error("An existing terminal account conflicts with the verified customer or account state."), { status: 409 });
    }
    if (!existing && accounts.byCode.length > 0) {
      throw Object.assign(new Error("This account code is already linked to another terminal record; no mapping was changed."), { status: 409 });
    }

    const catalog = await ensureCatalog(source);
    let product = null;
    let phase = null;
    let ruleVersion = null;
    if (existing) {
      [product] = await rows("products", new URLSearchParams({
        select: "id,code,status",
        id: `eq.${existing.product_id}`,
        limit: "2",
      }));
      [phase] = await rows("account_phases", new URLSearchParams({
        select: "id,code,status",
        id: `eq.${existing.phase_id}`,
        limit: "2",
      }));
      if (existing.rule_version_id) {
        [ruleVersion] = await rows("rule_versions", new URLSearchParams({
          select: "id,status,rules",
          id: `eq.${existing.rule_version_id}`,
          limit: "2",
        }));
      }
      if (!identity || existing.external_account_id !== source.account.id ||
          existing.product_id !== catalog.product.id || existing.phase_id !== catalog.phase.id ||
          (existing.rule_version_id ?? null) !== (catalog.ruleVersion?.id ?? null) ||
          existing.account_type !== source.challenge.plan ||
          product?.status !== "active" || phase?.status !== "active" ||
          product?.id !== catalog.product.id || phase?.id !== catalog.phase.id ||
          (existing.rule_version_id && (!ruleVersion || ruleVersion.status !== "active"))) {
        throw Object.assign(new Error("An existing terminal account has incomplete or conflicting verified account data."), { status: 409 });
      }
    }

    return {
      identity,
      account: existing,
      product: catalog.product,
      phase: catalog.phase,
      identityAction: identity ? "reuse_existing_identity" : "invite_existing_customer",
      accountAction: existing ? "already_linked" : "create_terminal_mapping",
      ruleVersion,
    };
  }

  async function ensureCatalog(source) {
    const productCode = canonicalFundedWealthProductCode(source.challenge.plan);
    const phaseCode = source.challenge.type === "funded" ? "FUNDED" : "CHALLENGE";

    const products = await rows("products", new URLSearchParams({
      select: "id,code,name,status",
      code: `eq.${productCode}`,
      limit: "2",
    }));
    if (products.length !== 1 || products[0].status !== "active") {
      throw Object.assign(new Error("The canonical active terminal product is missing or ambiguous."), { status: 409 });
    }
    const product = products[0];

    const phases = await rows("account_phases", new URLSearchParams({
      select: "id,code,name,status",
      product_id: `eq.${product.id}`,
      code: `eq.${phaseCode}`,
      limit: "2",
    }));
    if (phases.length !== 1 || phases[0].status !== "active" || phases[0].code !== phaseCode) {
      throw Object.assign(new Error("The canonical active terminal account phase is missing or ambiguous."), { status: 409 });
    }
    const phase = phases[0];

    const activeRules = await rows("rule_versions", new URLSearchParams({
      select: "id,version,status,rules",
      product_id: `eq.${product.id}`,
      phase_id: `eq.${phase.id}`,
      status: "eq.active",
      limit: "2",
    }));
    const matchingRules = activeRules.filter((ruleVersion) =>
      isCompatibleFundedWealthRuleVersion(ruleVersion, source, phaseCode));
    if (matchingRules.length > 1) {
      throw Object.assign(new Error("More than one active terminal rule version matches the verified FundedWealth limits; resolve it through the existing Terminal OS rule workflow."), { status: 409 });
    }
    if (matchingRules.length === 0) {
      throw Object.assign(new Error("No active terminal rule version matches the verified FundedWealth challenge; publish the correct version through the existing Terminal OS rule workflow before linking."), { status: 409 });
    }
    const ruleVersion = matchingRules[0];

    return { product, phase, ruleVersion: ruleVersion ?? null };
  }

  return {
    inspect,
    async inviteIdentity(source) {
      const metadata = source.customer.name ? { full_name: source.customer.name } : {};
      try {
        const invited = await request("/auth/v1/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: source.customer.email, data: metadata }),
        });
        const user = invited?.user ?? invited;
        if (!user?.id || user.email?.toLowerCase() !== source.customer.email) {
          throw Object.assign(new Error("Supabase Auth did not return the invited customer identity."), { status: 502 });
        }
        return user;
      } catch (error) {
        const existing = await findIdentity(source.customer.email);
        if (existing) return existing;
        throw error;
      }
    },
    async createAccount(source, identity) {
      const catalog = await ensureCatalog(source);
      const amount = (value, percent) => value * percent / 100;
      const payload = {
        owner_user_id: identity.id,
        external_account_id: source.account.id,
        account_code: source.account.accountCode,
        prop_firm: "FundedWealth",
        challenge_type: source.challenge.type,
        account_type: source.challenge.plan,
        starting_balance: source.challenge.initialBalance,
        current_balance: source.challenge.currentBalance,
        equity: source.challenge.currentBalance,
        peak_equity: source.challenge.peakBalance,
        currency: "INR",
        status: "active",
        is_active: true,
        daily_loss_limit: amount(source.challenge.initialBalance, source.challenge.dailyLossLimitPct),
        maximum_drawdown: amount(source.challenge.initialBalance, source.challenge.maxDrawdownPct),
        drawdown_percentage: source.challenge.maxDrawdownPct,
        profit_target: amount(source.challenge.initialBalance, source.challenge.profitTargetPct),
        expires_at: source.challenge.expiresAt ?? null,
        product_id: catalog.product.id,
        phase_id: catalog.phase.id,
        ...(catalog.ruleVersion ? { rule_version_id: catalog.ruleVersion.id } : {}),
        ...(source.account.availableMargin !== null ? { available_margin: source.account.availableMargin } : {}),
        ...(source.account.usedMargin !== null ? { used_margin: source.account.usedMargin } : {}),
      };

      await request("/rest/v1/trading_accounts?on_conflict=owner_user_id%2Cexternal_account_id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(payload),
      });

      const [account] = await rows("trading_accounts", new URLSearchParams({
        select: "id,owner_user_id,external_account_id,account_code,account_type,status,is_active,starting_balance,current_balance,equity,peak_equity,daily_loss_limit,maximum_drawdown,drawdown_percentage,profit_target,product_id,phase_id,rule_version_id",
        owner_user_id: `eq.${identity.id}`,
        external_account_id: `eq.${source.account.id}`,
        limit: "2",
      }));
      if (!account || account.account_code !== source.account.accountCode ||
          account.owner_user_id !== identity.id || account.external_account_id !== source.account.id ||
          account.account_type !== source.challenge.plan || account.status !== "active" ||
          account.is_active !== true || account.product_id !== catalog.product.id ||
          account.phase_id !== catalog.phase.id ||
          (account.rule_version_id ?? null) !== (catalog.ruleVersion?.id ?? null) ||
          Number(account.starting_balance) !== source.challenge.initialBalance ||
          Number(account.current_balance) !== source.challenge.currentBalance ||
          Number(account.equity) !== source.challenge.currentBalance ||
          Number(account.peak_equity) !== source.challenge.peakBalance ||
          Number(account.daily_loss_limit) !== amount(source.challenge.initialBalance, source.challenge.dailyLossLimitPct) ||
          Number(account.maximum_drawdown) !== amount(source.challenge.initialBalance, source.challenge.maxDrawdownPct) ||
          Number(account.drawdown_percentage) !== source.challenge.maxDrawdownPct ||
          Number(account.profit_target) !== amount(source.challenge.initialBalance, source.challenge.profitTargetPct)) {
        throw Object.assign(new Error("The terminal account mapping could not be verified after creation."), { status: 502 });
      }

      return account;
    },
    async writeAudit(source, identity, account, actor, outcome) {
      await request("/rest/v1/terminal_activity", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          owner_user_id: identity.id,
          account_id: account?.id ?? null,
          event_type: "admin_account_link",
          metadata: {
            actor_id: actor.id,
            source_account_id: source.account.id,
            account_code: source.account.accountCode,
            outcome,
          },
        }),
      });
    },
  };
}

export function createTerminalAccountLinkWorkflow(store) {
  async function preview(source) {
    const validated = validateSource(source);
    const result = await store.inspect(validated);
    return {
      customer: { id: validated.customer.id, email: validated.customer.email, name: validated.customer.name ?? null },
      account: {
        id: validated.account.id,
        accountCode: validated.account.accountCode,
        challengeType: validated.challenge.type,
        plan: validated.challenge.plan,
        status: validated.account.status,
        challengeStatus: validated.challenge.status,
        initialBalance: validated.challenge.initialBalance,
        currentBalance: validated.challenge.currentBalance,
        rules: {
          profitTargetPct: validated.challenge.profitTargetPct,
          dailyLossLimitPct: validated.challenge.dailyLossLimitPct,
          maxDrawdownPct: validated.challenge.maxDrawdownPct,
          minTradingDays: validated.challenge.minTradingDays,
        },
      },
      terminalRuleAction: "reuse_existing_compatible_active_rules",
      identityAction: result.identityAction,
      accountAction: result.accountAction,
    };
  }

  async function link(source, actor) {
    const validated = validateSource(source);
    const plan = await store.inspect(validated);
    if (plan.accountAction === "already_linked") {
      try {
        await store.writeAudit(validated, plan.identity, plan.account, actor, "already_linked");
      } catch {
        throw Object.assign(new Error("The mapping already exists, but its terminal audit event could not be recorded."), { status: 500 });
      }
      return { created: false, accountId: plan.account.id, identityId: plan.identity.id };
    }

    const identity = plan.identity ?? await store.inviteIdentity(validated);
    if (!identity?.id || identity.email?.toLowerCase() !== validated.customer.email) {
      throw Object.assign(new Error("The terminal identity does not match the verified FundedWealth customer."), { status: 409 });
    }

    try {
      await store.writeAudit(validated, identity, null, actor, "link_started");
    } catch (error) {
      throw Object.assign(
        new Error("The existing customer identity was verified, but the terminal audit preflight could not be recorded; no account mapping was created."),
        { status: 500, ...(error?.database ? { database: error.database } : {}) },
      );
    }

    let account;
    account = await store.createAccount(validated, identity);

    try {
      await store.writeAudit(validated, identity, account, actor, "linked");
    } catch {
      return { created: true, accountId: account.id, identityId: identity.id, auditPending: true };
    }
    return { created: true, accountId: account.id, identityId: identity.id };
  }

  return { preview, link };
}

export function createTerminalAccountLinkHandlers({ fetchImpl = fetch, env = process.env, store } = {}) {
  const workflow = createTerminalAccountLinkWorkflow(store ?? makeSupabaseStore({ fetchImpl, env }));

  async function handle(req) {
    const sharedKey = env.SSO_API_KEY || env.SSO_SHARED_SECRET;
    if (!sharedKey) return jsonResponse(503, { error: "Terminal account-link service is not configured." });
    if (!equalSecret(req.headers["x-sso-api-key"], sharedKey)) return jsonResponse(401, { error: "Unauthorized" });

    try {
      const body = await readBody(req);
      if (body.mode !== "preview" && body.mode !== "confirm") {
        return jsonResponse(400, { error: "mode must be preview or confirm." });
      }
      const source = validateSource(body.source);
      if (body.mode === "preview") {
        return jsonResponse(200, { success: true, preview: await workflow.preview(source) });
      }

      if (body.confirmation !== `LINK ${source.account.accountCode}`) {
        return jsonResponse(400, { error: "Explicit account-code confirmation is required." });
      }
      if (!body.actor?.id || !EMAIL_PATTERN.test(body.actor.email ?? "")) {
        return jsonResponse(400, { error: "A verified Admin OS actor is required." });
      }

      const result = await workflow.link(source, {
        id: body.actor.id,
        email: body.actor.email.toLowerCase(),
      });
      return jsonResponse(200, { success: true, result });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (error?.database) {
        console.error("[terminal-account-link] Supabase request failed", error.database);
      }
      return jsonResponse(status, {
        error: status < 500 ? error.message : "Terminal account linking failed.",
      });
    }
  }

  return { handle };
}
