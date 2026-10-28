import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  canonicalizeLegacyInstantFundedRules,
  canonicalFundedWealthProductCode,
  createTerminalAccountLinkHandlers,
  createTerminalAccountLinkWorkflow,
  isCompatibleFundedWealthRuleVersion,
} from "../terminal-account-link.mjs";

const secret = "test-only-shared-key";
const source = {
  customer: { id: "11111111-1111-4111-8111-111111111111", email: "trader@example.test", name: "Test Trader" },
  account: {
    id: "22222222-2222-4222-8222-222222222222",
    traderId: "33333333-3333-4333-8333-333333333333",
    accountCode: "FW-EXISTING-ACCOUNT",
    status: "active",
    balance: 100000,
  },
  challenge: {
    id: "44444444-4444-4444-8444-444444444444",
    traderId: "33333333-3333-4333-8333-333333333333",
    status: "active",
    type: "evaluation_phase1",
    plan: "1-Step",
    initialBalance: 100000,
    currentBalance: 100000,
    peakBalance: 100000,
    profitTargetPct: 10,
    dailyLossLimitPct: 3,
    maxDrawdownPct: 6,
    minTradingDays: 5,
  },
  provisioning: {
    status: "completed",
    traderId: "33333333-3333-4333-8333-333333333333",
    tradingAccountId: "22222222-2222-4222-8222-222222222222",
    challengeAccountId: "44444444-4444-4444-8444-444444444444",
  },
};

function request(body, headers = {}) {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
  stream.headers = headers;
  return stream;
}

function makeStore({ identity = null, account = null, conflict = false, accountAction } = {}) {
  const calls = { invites: 0, creates: 0, reconciles: 0, audits: 0, inspectOptions: [] };
  let currentIdentity = identity;
  let currentAccount = account;
  return {
    calls,
    store: {
      async inspect(_source, options = {}) {
        calls.inspectOptions.push(options);
        if (conflict) throw Object.assign(new Error("Account owner conflict."), { status: 409 });
        return {
          identity: currentIdentity,
          account: currentAccount,
          identityAction: currentIdentity ? "reuse_existing_identity" : "invite_existing_customer",
          accountAction: accountAction ?? (currentAccount ? "already_linked" : "create_terminal_mapping"),
          ruleSet: {},
        };
      },
      async inviteIdentity() {
        calls.invites += 1;
        currentIdentity = { id: "55555555-5555-4555-8555-555555555555", email: source.customer.email };
        return currentIdentity;
      },
      async createAccount(_source, owner) {
        calls.creates += 1;
        currentAccount = {
          id: "66666666-6666-4666-8666-666666666666",
          owner_user_id: owner.id,
        };
        return currentAccount;
      },
      async reconcileExternalAccountId(_source, _owner, existingAccount) {
        calls.reconciles += 1;
        currentAccount = existingAccount;
        return currentAccount;
      },
      async writeAudit() {
        calls.audits += 1;
      },
    },
  };
}

test("maps account-size-prefixed FundedWealth step plans to canonical terminal products", () => {
  assert.equal(canonicalFundedWealthProductCode("100k-1step"), "1-STEP");
  assert.equal(canonicalFundedWealthProductCode("50K 2 Step Evaluation"), "2-STEP");
  assert.equal(canonicalFundedWealthProductCode("1-Step"), "1-STEP");
  assert.equal(canonicalFundedWealthProductCode("FLASH"), "FLASH");
  assert.equal(canonicalFundedWealthProductCode("250k-flash"), "FLASH");
  assert.equal(canonicalFundedWealthProductCode("50k-flash"), "FLASH");
  assert.equal(canonicalFundedWealthProductCode("500k-instant"), "INSTANT");
});

test("matches canonical nested 1-Step rules and rejects versions with different challenge limits", () => {
  const activeVersion = {
    status: "active",
    rules: {
      evaluation_rules: {
        max_drawdown_percent: 6,
        daily_drawdown_percent: 3,
        profit_target_percent: 10,
        max_risk_per_trade_percent: 1.5,
        minimum_trading_days: 5,
      },
    },
  };

  assert.equal(isCompatibleFundedWealthRuleVersion(activeVersion, source, "CHALLENGE"), true);
  assert.equal(isCompatibleFundedWealthRuleVersion({
    ...activeVersion,
    rules: {
      evaluation_rules: {
        ...activeVersion.rules.evaluation_rules,
        daily_drawdown_percent: 4,
      },
    },
  }, source, "CHALLENGE"), false);
  assert.equal(isCompatibleFundedWealthRuleVersion(activeVersion, source, "FUNDED"), false);
});

test("matches funded Flash and Instant rules without relaxing any challenge limit", () => {
  const fundedSource = (plan, { profitTargetPct, dailyLossLimitPct, maxDrawdownPct, minTradingDays }) => ({
    challenge: {
      ...source.challenge,
      plan,
      type: "funded",
      profitTargetPct,
      dailyLossLimitPct,
      maxDrawdownPct,
      minTradingDays,
    },
  });
  const flashRules = {
    funded_rules: {
      max_drawdown_percent: 4,
      daily_drawdown_percent: 2,
      profit_target_percent: 0,
      max_risk_per_trade_percent: 2,
      minimum_trading_days: 0,
    },
  };
  const instantRules = {
    funded_rules: {
      max_drawdown_percent: 5,
      daily_drawdown_percent: 3,
      profit_target_percent: 0,
      max_risk_per_trade_percent: 1,
      minimum_trading_days: 7,
    },
  };

  assert.equal(isCompatibleFundedWealthRuleVersion(
    { rules: flashRules },
    fundedSource("250k-flash", { profitTargetPct: 0, dailyLossLimitPct: 2, maxDrawdownPct: 4, minTradingDays: 0 }),
    "FUNDED",
  ), true);
  assert.equal(isCompatibleFundedWealthRuleVersion(
    { rules: instantRules },
    fundedSource("500k-instant", { profitTargetPct: 0, dailyLossLimitPct: 3, maxDrawdownPct: 5, minTradingDays: 7 }),
    "FUNDED",
  ), true);
  assert.equal(isCompatibleFundedWealthRuleVersion(
    { rules: flashRules },
    fundedSource("flash", { profitTargetPct: 0, dailyLossLimitPct: 3, maxDrawdownPct: 4, minTradingDays: 0 }),
    "FUNDED",
  ), false);
});

test("repairs only the seeded legacy Instant funded rules shape", () => {
  const legacyVersion = {
    status: "active",
    rules: {
      plan_name: "INSTANT",
      max_drawdown_percent: 5,
      daily_drawdown_percent: 3,
      trading_days: 7,
      profit_target_percent: null,
      funded_rules: null,
    },
  };
  const repairedRules = canonicalizeLegacyInstantFundedRules(legacyVersion);
  const instantSource = {
    ...source,
    challenge: {
      ...source.challenge,
      plan: "10L Instant",
      type: "funded",
      profitTargetPct: 0,
      dailyLossLimitPct: 3,
      maxDrawdownPct: 5,
      minTradingDays: 7,
    },
  };

  assert.deepEqual(repairedRules.funded_rules, {
    max_drawdown_percent: 5,
    daily_drawdown_percent: 3,
    profit_target_percent: 0,
    max_risk_per_trade_percent: 1,
    minimum_trading_days: 7,
  });
  assert.equal(isCompatibleFundedWealthRuleVersion({ rules: repairedRules }, instantSource, "FUNDED"), true);
  assert.equal(canonicalizeLegacyInstantFundedRules({
    ...legacyVersion,
    rules: { ...legacyVersion.rules, max_drawdown_percent: 6 },
  }), null);
});

test("the forward migration publishes the canonical Instant funded rule successor", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261027000100_instant_funded_rule_compatibility.sql"),
    "utf8",
  );
  assert.match(migration, /version = 'v1'/);
  assert.match(migration, /'max_drawdown_percent', 5/);
  assert.match(migration, /'daily_drawdown_percent', 3/);
  assert.match(migration, /'profit_target_percent', 0/);
  assert.match(migration, /'max_risk_per_trade_percent', 1/);
  assert.match(migration, /'minimum_trading_days', 7/);
  assert.match(migration, /version = 'v2'/);
  assert.match(migration, /'publish_rule_version'/);
});

test("trusted Instant linking publishes the audited canonical rule before creating its account mapping", async () => {
  const identity = { id: "55555555-5555-4555-8555-555555555555", email: source.customer.email };
  const product = { id: "77777777-7777-4777-8777-777777777777", code: "INSTANT", status: "active" };
  const phase = { id: "88888888-8888-4888-8888-888888888888", product_id: product.id, code: "FUNDED", status: "active" };
  const legacyRule = {
    id: "99999999-9999-4999-8999-999999999999",
    version: "v1",
    status: "active",
    rules: {
      plan_name: "INSTANT",
      max_drawdown_percent: 5,
      daily_drawdown_percent: 3,
      trading_days: 7,
      profit_target_percent: null,
      funded_rules: null,
    },
  };
  const instantSource = {
    ...source,
    account: { ...source.account, accountCode: "FW-INSTANT-ACCOUNT", balance: 1_000_000 },
    challenge: {
      ...source.challenge,
      type: "funded",
      plan: "10L Instant",
      initialBalance: 1_000_000,
      currentBalance: 1_000_000,
      peakBalance: 1_000_000,
      profitTargetPct: 0,
      dailyLossLimitPct: 3,
      maxDrawdownPct: 5,
      minTradingDays: 7,
    },
  };
  let canonicalRule = null;
  let account = null;
  const ruleActions = [];

  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const method = init.method ?? "GET";
    let body = [];

    if (parsed.pathname === "/auth/v1/admin/users") {
      body = [identity];
    } else if (parsed.pathname === "/rest/v1/products") {
      body = [product];
    } else if (parsed.pathname === "/rest/v1/account_phases") {
      body = [phase];
    } else if (parsed.pathname === "/rest/v1/rule_versions" && method === "GET") {
      if (params.get("version") === "eq.v2") {
        body = canonicalRule ? [canonicalRule] : [];
      } else if (params.get("id") === `eq.${legacyRule.id}`) {
        body = [legacyRule];
      } else {
        body = [legacyRule, ...(canonicalRule?.status === "active" ? [canonicalRule] : [])];
      }
    } else if (parsed.pathname === "/rest/v1/rpc/manage_rule_configuration" && method === "POST") {
      const rpcArgs = JSON.parse(init.body);
      assert.deepEqual(Object.keys(rpcArgs), ["request"]);
      const requestBody = rpcArgs.request;
      ruleActions.push(requestBody.action);
      assert.equal(requestBody.actor_email, "account-linker@fundedwealth.com");
      if (requestBody.action === "create_rule_version") {
        canonicalRule = {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: requestBody.version,
          status: "draft",
          rules: requestBody.rules,
        };
      } else if (requestBody.action === "publish_rule_version") {
        canonicalRule.status = "active";
      } else {
        assert.fail(`Unexpected rule management action: ${requestBody.action}`);
      }
      body = { rule_version: canonicalRule };
    } else if (parsed.pathname === "/rest/v1/trading_accounts") {
      if (method === "POST") {
        const values = JSON.parse(init.body);
        account = {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          ...values,
          equity: values.equity,
          peak_equity: values.peak_equity,
        };
        return new Response("", { status: 201 });
      }
      body = account && account.owner_user_id === identity.id &&
        account.external_account_id === instantSource.account.id &&
        (!params.has("account_code") || account.account_code === instantSource.account.accountCode)
        ? [account]
        : [];
    } else if (parsed.pathname === "/rest/v1/terminal_activity" && method === "POST") {
      return new Response("", { status: 201 });
    }

    return new Response(JSON.stringify(body), { status: 200 });
  };

  const handlers = createTerminalAccountLinkHandlers({
    env: {
      SSO_API_KEY: secret,
      SUPABASE_URL: "https://terminal.example.test",
      SUPABASE_SECRET_KEY: "service-role-test-key",
    },
    fetchImpl,
  });
  const response = await handlers.handle(request(
    { mode: "ensure", source: instantSource },
    { "x-sso-api-key": secret },
  ));
  const result = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(result.result.created, true);
  assert.deepEqual(ruleActions, ["create_rule_version", "publish_rule_version"]);
  assert.equal(canonicalRule.status, "active");
  assert.equal(account.owner_user_id, identity.id);
  assert.equal(account.rule_version_id, canonicalRule.id);
  assert.deepEqual(canonicalRule.rules.funded_rules, {
    max_drawdown_percent: 5,
    daily_drawdown_percent: 3,
    profit_target_percent: 0,
    max_risk_per_trade_percent: 1,
    minimum_trading_days: 7,
  });
});

test("previews an existing customer identity and already-linked account without writes", async () => {
  const identity = { id: "55555555-5555-4555-8555-555555555555", email: source.customer.email };
  const account = { id: "66666666-6666-4666-8666-666666666666", owner_user_id: identity.id };
  const { store, calls } = makeStore({ identity, account });
  const workflow = createTerminalAccountLinkWorkflow(store);

  const result = await workflow.preview(source);

  assert.equal(result.identityAction, "reuse_existing_identity");
  assert.equal(result.accountAction, "already_linked");
  assert.equal(calls.invites, 0);
  assert.equal(calls.creates, 0);
  assert.deepEqual(calls.inspectOptions, [{}]);
});

test("invites the existing customer and creates the terminal mapping after confirmation", async () => {
  const { store, calls } = makeStore();
  const result = await createTerminalAccountLinkWorkflow(store).link(source, {
    id: "admin-1",
    email: "founder@example.test",
  });

  assert.equal(result.created, true);
  assert.equal(calls.invites, 1);
  assert.equal(calls.creates, 1);
  assert.equal(calls.audits, 2);
});

test("preserves sanitized database failure details when the audit preflight fails", async () => {
  const database = { endpoint: "/rest/v1/terminal_activity", status: 403, code: "42501" };
  const workflow = createTerminalAccountLinkWorkflow({
    async inspect() {
      return {
        identity: { id: "55555555-5555-4555-8555-555555555555", email: source.customer.email },
        account: null,
        identityAction: "reuse_existing_identity",
        accountAction: "create_terminal_mapping",
      };
    },
    async writeAudit() {
      throw Object.assign(new Error("Database request failed."), { database });
    },
    async createAccount() {
      assert.fail("The account mapping must not be created when the audit preflight fails.");
    },
  });

  await assert.rejects(
    workflow.link(source, { id: "admin-1", email: "founder@example.test" }),
    (error) => {
      assert.equal(error.status, 500);
      assert.deepEqual(error.database, database);
      return true;
    },
  );
});

test("a duplicate confirmation is idempotent and does not create a second identity or account", async () => {
  const { store, calls } = makeStore();
  const workflow = createTerminalAccountLinkWorkflow(store);
  await workflow.link(source, { id: "admin-1", email: "founder@example.test" });
  const retry = await workflow.link(source, { id: "admin-1", email: "founder@example.test" });

  assert.equal(retry.created, false);
  assert.equal(calls.invites, 1);
  assert.equal(calls.creates, 1);
});

test("trusted provisioning ensure preflights and audits idempotent mapping creation", async () => {
  const { store, calls } = makeStore();
  const result = await createTerminalAccountLinkWorkflow(store).ensure(source);

  assert.equal(result.created, true);
  assert.equal(calls.invites, 1);
  assert.equal(calls.creates, 1);
  assert.equal(calls.audits, 2);
  assert.deepEqual(calls.inspectOptions, [{ repairLegacyInstantRules: true }]);
});

test("accepts legacy accounts only with the trusted ownership-verified marker", async () => {
  const { store } = makeStore();
  const workflow = createTerminalAccountLinkWorkflow(store);
  const legacySource = {
    ...source,
    provisioning: { ...source.provisioning, status: "ownership_verified" },
  };

  const preview = await workflow.preview(legacySource);
  assert.equal(preview.account.id, source.account.id);

  await assert.rejects(
    workflow.preview({
      ...legacySource,
      provisioning: { ...legacySource.provisioning, status: "processing" },
    }),
    { status: 409 },
  );
});

test("reconciles a legacy external account identifier in place for the verified owner", async () => {
  const identity = { id: "55555555-5555-4555-8555-555555555555", email: source.customer.email };
  const account = { id: "66666666-6666-4666-8666-666666666666", owner_user_id: identity.id };
  const { store, calls } = makeStore({ identity, account, accountAction: "reconcile_external_account_id" });

  const result = await createTerminalAccountLinkWorkflow(store).ensure(source);

  assert.equal(result.created, false);
  assert.equal(result.reconciled, true);
  assert.equal(result.accountId, account.id);
  assert.equal(calls.creates, 0);
  assert.equal(calls.reconciles, 1);
});

test("database reconciliation updates the existing same-owner account instead of inserting a duplicate", async () => {
  const identity = { id: "55555555-5555-4555-8555-555555555555", email: source.customer.email };
  const product = { id: "77777777-7777-4777-8777-777777777777", code: "1-STEP", status: "active" };
  const phase = { id: "88888888-8888-4888-8888-888888888888", code: "CHALLENGE", status: "active" };
  const ruleVersion = {
    id: "99999999-9999-4999-8999-999999999999",
    status: "active",
    rules: {
      evaluation_rules: {
        max_drawdown_percent: 6,
        daily_drawdown_percent: 3,
        profit_target_percent: 10,
        max_risk_per_trade_percent: 1.5,
        minimum_trading_days: 5,
      },
    },
  };
  const existing = {
    id: "66666666-6666-4666-8666-666666666666",
    owner_user_id: identity.id,
    external_account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    account_code: source.account.accountCode,
    account_type: source.challenge.plan,
    status: "active",
    is_active: true,
    starting_balance: 100000,
    current_balance: 100000,
    equity: 100000,
    peak_equity: 100000,
    daily_loss_limit: 3000,
    maximum_drawdown: 6000,
    drawdown_percentage: 6,
    profit_target: 10000,
    product_id: product.id,
    phase_id: phase.id,
    rule_version_id: ruleVersion.id,
  };
  const calls = { accountInserts: 0, accountPatches: 0, audits: 0 };

  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const method = init.method ?? "GET";
    let body = [];

    if (parsed.pathname === "/auth/v1/admin/users") {
      body = [identity];
    } else if (parsed.pathname === "/rest/v1/trading_accounts") {
      if (method === "PATCH") {
        calls.accountPatches += 1;
        assert.equal(params.get("id"), `eq.${existing.id}`);
        assert.equal(params.get("owner_user_id"), `eq.${identity.id}`);
        assert.equal(params.get("external_account_id"), `eq.${existing.external_account_id}`);
        const patch = JSON.parse(init.body);
        assert.equal(patch.external_account_id, source.account.id);
        existing.external_account_id = patch.external_account_id;
        body = [existing];
      } else if (method === "POST") {
        calls.accountInserts += 1;
      } else if (params.has("external_account_id")) {
        body = params.get("external_account_id") === `eq.${existing.external_account_id}` ? [existing] : [];
      } else if (params.has("account_code")) {
        body = [existing];
      }
    } else if (parsed.pathname === "/rest/v1/products") {
      body = params.has("id") ? [product] : [product];
    } else if (parsed.pathname === "/rest/v1/account_phases") {
      body = [phase];
    } else if (parsed.pathname === "/rest/v1/rule_versions") {
      body = [ruleVersion];
    } else if (parsed.pathname === "/rest/v1/terminal_activity" && method === "POST") {
      calls.audits += 1;
      body = null;
    }

    return new Response(body === null ? "" : JSON.stringify(body), { status: 200 });
  };
  const handlers = createTerminalAccountLinkHandlers({
    env: {
      SSO_API_KEY: secret,
      SUPABASE_URL: "https://terminal.example.test",
      SUPABASE_SECRET_KEY: "service-role-test-key",
    },
    fetchImpl,
  });

  const response = await handlers.handle(request(
    { mode: "ensure", source },
    { "x-sso-api-key": secret },
  ));
  const result = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.result.reconciled, true);
  assert.equal(result.result.accountId, existing.id);
  assert.equal(existing.external_account_id, source.account.id);
  assert.equal(calls.accountPatches, 1);
  assert.equal(calls.accountInserts, 0);
  assert.equal(calls.audits, 2);
});

test("rejects an account already owned by a different terminal identity", async () => {
  const { store, calls } = makeStore({ conflict: true });
  await assert.rejects(
    createTerminalAccountLinkWorkflow(store).link(source, { id: "admin-1", email: "founder@example.test" }),
    { status: 409 },
  );
  assert.equal(calls.invites, 0);
  assert.equal(calls.creates, 0);
});

test("rejects inactive accounts before creating identities or terminal records", async () => {
  const { store, calls } = makeStore();
  await assert.rejects(
    createTerminalAccountLinkWorkflow(store).preview({
      ...source,
      account: { ...source.account, status: "inactive" },
    }),
    { status: 409 },
  );
  assert.equal(calls.invites, 0);
  assert.equal(calls.creates, 0);
});

test("rejects unauthorized callers and requires explicit account-code confirmation", async () => {
  const { store, calls } = makeStore();
  const handlers = createTerminalAccountLinkHandlers({
    env: { SSO_API_KEY: secret },
    store,
  });
  const denied = await handlers.handle(request({ mode: "preview", source }, { "x-sso-api-key": "wrong" }));
  assert.equal(denied.status, 401);
  assert.equal(calls.invites, 0);
  assert.equal(calls.creates, 0);

  const deniedEnsure = await handlers.handle(request({ mode: "ensure", source }, { "x-sso-api-key": "wrong" }));
  assert.equal(deniedEnsure.status, 401);
  assert.equal(calls.invites, 0);
  assert.equal(calls.creates, 0);

  const ensured = await handlers.handle(request({ mode: "ensure", source }, { "x-sso-api-key": secret }));
  assert.equal(ensured.status, 200);
  assert.equal(JSON.parse(ensured.body).success, true);
  assert.equal(calls.invites, 1);
  assert.equal(calls.creates, 1);

  const noConfirmation = await handlers.handle(request({
    mode: "confirm",
    source,
    actor: { id: "admin-1", email: "founder@example.test" },
    confirmation: "yes",
  }, { "x-sso-api-key": secret }));
  assert.equal(noConfirmation.status, 400);
  assert.equal(calls.invites, 1);
  assert.equal(calls.creates, 1);
});
