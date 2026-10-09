import { describe, expect, it } from "vitest";
import {
  issueLaunchCode,
  redeemLaunchCode,
  SSO_BRIDGE_BLOCKER,
  type BridgeAccountRecord,
  type BridgeUserRecord,
  type LaunchCodeRecord,
} from "@/lib/ssoBridge";

describe("terminal SSO bridge", () => {
  const makeUser = (mainUserId: string, newTerminalUserId: string): BridgeUserRecord => ({
    mainUserId,
    newTerminalUserId,
    email: `${newTerminalUserId}@example.local`,
  });

  const makeAccount = (id: string, ownerUserId: string): BridgeAccountRecord => ({
    id,
    owner_user_id: ownerUserId,
    account_code: `AC-${id.slice(0, 4).toUpperCase()}`,
    status: "active",
    is_active: true,
    product_id: "prod-1",
    phase_id: "phase-1",
    permissions: { can_trade: true, can_view: true },
  });

  it("issues and redeems a valid one-time launch code when a backend session creator is available", async () => {
    const user = makeUser("main-user-1", "terminal-user-1");
    const account = makeAccount("acct-1", "terminal-user-1");
    const issued = issueLaunchCode({
      mainUserId: user.mainUserId,
      newTerminalUserId: user.newTerminalUserId,
      accountId: account.id,
      requestedRoute: "/",
      ttlMs: 60_000,
      sessionCreator: async () => ({ supported: true, sessionId: "sess-123" }),
    });

    const result = await redeemLaunchCode({
      code: issued.code,
      mainUserId: user.mainUserId,
      newTerminalUserId: user.newTerminalUserId,
      requestedAccountId: account.id,
      userResolver: async () => user,
      accountResolver: async () => account,
      sessionCreator: async () => ({ supported: true, sessionId: "sess-456" }),
      now: Date.now(),
    });

    expect(result.ok).toBe(true);
    expect(result.redirectUrl).toContain("/dashboard");
    expect(result.redeemed).toBe(true);
  });

  it("rejects expired launch codes", async () => {
    const issued = issueLaunchCode({
      mainUserId: "main-user-2",
      newTerminalUserId: "terminal-user-2",
      accountId: "acct-2",
      requestedRoute: "/",
      ttlMs: 60_000,
      sessionCreator: async () => ({ supported: true, sessionId: "sess-2" }),
    });

    await expect(redeemLaunchCode({
      code: issued.code,
      mainUserId: "main-user-2",
      newTerminalUserId: "terminal-user-2",
      requestedAccountId: "acct-2",
      userResolver: async () => makeUser("main-user-2", "terminal-user-2"),
      accountResolver: async () => makeAccount("acct-2", "terminal-user-2"),
      sessionCreator: async () => ({ supported: true, sessionId: "sess-2" }),
      now: Date.now() + 120_000,
    })).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("removes redeemed launch codes from the bridge store so retries fail as invalid", async () => {
    const issued = issueLaunchCode({
      mainUserId: "main-user-3",
      newTerminalUserId: "terminal-user-3",
      accountId: "acct-3",
      requestedRoute: "/options",
      ttlMs: 60_000,
      sessionCreator: async () => ({ supported: true, sessionId: "sess-3" }),
    });

    await redeemLaunchCode({
      code: issued.code,
      mainUserId: "main-user-3",
      newTerminalUserId: "terminal-user-3",
      requestedAccountId: "acct-3",
      userResolver: async () => makeUser("main-user-3", "terminal-user-3"),
      accountResolver: async () => makeAccount("acct-3", "terminal-user-3"),
      sessionCreator: async () => ({ supported: true, sessionId: "sess-3" }),
      now: Date.now(),
    });

    await expect(redeemLaunchCode({
      code: issued.code,
      mainUserId: "main-user-3",
      newTerminalUserId: "terminal-user-3",
      requestedAccountId: "acct-3",
      userResolver: async () => makeUser("main-user-3", "terminal-user-3"),
      accountResolver: async () => makeAccount("acct-3", "terminal-user-3"),
      sessionCreator: async () => ({ supported: true, sessionId: "sess-3" }),
      now: Date.now() + 1,
    })).rejects.toMatchObject({ code: "INVALID" });
  });

  it("rejects mismatched main users and accounts", async () => {
    const issued = issueLaunchCode({
      mainUserId: "main-user-4",
      newTerminalUserId: "terminal-user-4",
      accountId: "acct-4",
      requestedRoute: "/",
      ttlMs: 60_000,
      sessionCreator: async () => ({ supported: true, sessionId: "sess-4" }),
    });

    await expect(redeemLaunchCode({
      code: issued.code,
      mainUserId: "main-user-999",
      newTerminalUserId: "terminal-user-4",
      requestedAccountId: "acct-4",
      userResolver: async () => makeUser("main-user-4", "terminal-user-4"),
      accountResolver: async () => makeAccount("acct-4", "terminal-user-4"),
      sessionCreator: async () => ({ supported: true, sessionId: "sess-4" }),
      now: Date.now(),
    })).rejects.toMatchObject({ code: "USER_MISMATCH" });
  });

  it("rejects unauthorized and inactive accounts", async () => {
    const issued = issueLaunchCode({
      mainUserId: "main-user-5",
      newTerminalUserId: "terminal-user-5",
      accountId: "acct-5",
      requestedRoute: "/",
      ttlMs: 60_000,
      sessionCreator: async () => ({ supported: true, sessionId: "sess-5" }),
    });

    await expect(redeemLaunchCode({
      code: issued.code,
      mainUserId: "main-user-5",
      newTerminalUserId: "terminal-user-5",
      requestedAccountId: "acct-5",
      userResolver: async () => makeUser("main-user-5", "terminal-user-5"),
      accountResolver: async () => ({ ...makeAccount("acct-5", "other-user"), status: "inactive", is_active: false }),
      sessionCreator: async () => ({ supported: true, sessionId: "sess-5" }),
      now: Date.now(),
    })).rejects.toMatchObject({ code: "ACCOUNT_NOT_AUTHORIZED" });
  });

  it("returns the explicit browser-session blocker when the backend cannot create a real Supabase session", async () => {
    const issued = issueLaunchCode({
      mainUserId: "main-user-6",
      newTerminalUserId: "terminal-user-6",
      accountId: "acct-6",
      requestedRoute: "/",
      ttlMs: 60_000,
      sessionCreator: async () => ({ supported: false, reason: SSO_BRIDGE_BLOCKER }),
    });

    await expect(redeemLaunchCode({
      code: issued.code,
      mainUserId: "main-user-6",
      newTerminalUserId: "terminal-user-6",
      requestedAccountId: "acct-6",
      userResolver: async () => makeUser("main-user-6", "terminal-user-6"),
      accountResolver: async () => makeAccount("acct-6", "terminal-user-6"),
      sessionCreator: async () => ({ supported: false, reason: SSO_BRIDGE_BLOCKER }),
      now: Date.now(),
    })).rejects.toMatchObject({ code: "BACKEND_SESSION_UNSUPPORTED" });
  });

  it("normalizes internal app paths and rejects external redirect targets", () => {
    expect(issueLaunchCode({
      mainUserId: "main-user-7",
      newTerminalUserId: "terminal-user-7",
      accountId: "acct-7",
      requestedRoute: "https://evil.example/pwned",
      sessionCreator: async () => ({ supported: true, sessionId: "sess-7" }),
    }).requestedRoute).toBe("/dashboard");

    expect(issueLaunchCode({
      mainUserId: "main-user-8",
      newTerminalUserId: "terminal-user-8",
      accountId: "acct-8",
      requestedRoute: "options?tab=greeks",
      sessionCreator: async () => ({ supported: true, sessionId: "sess-8" }),
    }).requestedRoute).toBe("/dashboard/options?tab=greeks");
  });

  it("rejects suspended or closed accounts even when ownership matches", async () => {
    const issued = issueLaunchCode({
      mainUserId: "main-user-9",
      newTerminalUserId: "terminal-user-9",
      accountId: "acct-9",
      requestedRoute: "/dashboard",
      ttlMs: 60_000,
      sessionCreator: async () => ({ supported: true, sessionId: "sess-9" }),
    });

    await expect(redeemLaunchCode({
      code: issued.code,
      mainUserId: "main-user-9",
      newTerminalUserId: "terminal-user-9",
      requestedAccountId: "acct-9",
      userResolver: async () => makeUser("main-user-9", "terminal-user-9"),
      accountResolver: async () => ({ ...makeAccount("acct-9", "terminal-user-9"), status: "suspended", is_active: true }),
      sessionCreator: async () => ({ supported: true, sessionId: "sess-9" }),
      now: Date.now(),
    })).rejects.toMatchObject({ code: "ACCOUNT_NOT_AUTHORIZED" });
  });
});
