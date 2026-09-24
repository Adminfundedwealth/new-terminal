export const ACCOUNT_STATUSES = [
  "active",
  "inactive",
  "suspended",
  "expired",
  "breached",
  "closed",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<AccountStatus, readonly AccountStatus[]> = {
  inactive: ["active", "closed"],
  active: ["suspended", "breached", "expired", "closed"],
  suspended: ["active", "closed"],
  breached: ["closed"],
  expired: ["closed"],
  closed: [],
};

export function canTransitionAccountStatus(current: string, next: string): next is AccountStatus {
  return ACCOUNT_STATUSES.includes(current as AccountStatus)
    && ALLOWED_TRANSITIONS[current as AccountStatus].includes(next as AccountStatus);
}