export declare const SSO_BRIDGE_BLOCKER = "The terminal must create a server-side Supabase session before accepting a cross-project SSO launch. Browser-only auth is not a valid bridge.";
export interface SessionCreationResult {
    supported: boolean;
    sessionId?: string;
    reason?: string;
}
export interface BridgeUserRecord {
    mainUserId: string;
    newTerminalUserId: string;
    email: string;
}
export interface BridgeAccountRecord {
    id: string;
    owner_user_id: string;
    account_code: string;
    status: string;
    is_active: boolean;
    product_id?: string;
    phase_id?: string;
    permissions?: Record<string, boolean>;
}
export interface LaunchCodeRecord {
    code: string;
    mainUserId: string;
    newTerminalUserId: string;
    accountId: string;
    requestedRoute: string;
    issuedAt: number;
    expiresAt: number;
    used: boolean;
    usedAt: number | null;
}
export interface IssueLaunchCodeInput {
    mainUserId: string;
    newTerminalUserId: string;
    accountId: string;
    requestedRoute?: string;
    ttlMs?: number;
    sessionCreator?: () => Promise<SessionCreationResult> | SessionCreationResult;
}
export interface RedeemLaunchCodeInput {
    code: string;
    mainUserId: string;
    newTerminalUserId: string;
    requestedAccountId: string;
    userResolver: () => Promise<BridgeUserRecord | null> | BridgeUserRecord | null;
    accountResolver: () => Promise<BridgeAccountRecord | null> | BridgeAccountRecord | null;
    sessionCreator: () => Promise<SessionCreationResult> | SessionCreationResult;
    now?: number;
}
export declare function issueLaunchCode(input: IssueLaunchCodeInput): LaunchCodeRecord;
export declare function redeemLaunchCode(input: RedeemLaunchCodeInput): Promise<{
    ok: true;
    redeemed: true;
    redirectUrl: string;
    sessionId?: string;
}>;
