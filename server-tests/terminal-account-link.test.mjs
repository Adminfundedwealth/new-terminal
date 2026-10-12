import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
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

function makeStore({ identity = null, account = null, conflict = false } = {}) {
  const calls = { invites: 0, creates: 0, audits: 0 };
  let currentIdentity = identity;
  let currentAccount = account;
  return {
    calls,
    store: {
      async inspect() {
        if (conflict) throw Object.assign(new Error("Account owner conflict."), { status: 409 });
        return {
          identity: currentIdentity,
          account: currentAccount,
          identityAction: currentIdentity ? "reuse_existing_identity" : "invite_existing_customer",
          accountAction: currentAccount ? "already_linked" : "create_terminal_mapping",
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

  const noConfirmation = await handlers.handle(request({
    mode: "confirm",
    source,
    actor: { id: "admin-1", email: "founder@example.test" },
    confirmation: "yes",
  }, { "x-sso-api-key": secret }));
  assert.equal(noConfirmation.status, 400);
  assert.equal(calls.invites, 0);
  assert.equal(calls.creates, 0);
});
