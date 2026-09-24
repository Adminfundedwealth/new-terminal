import { describe, expect, it } from "vitest";
import { canTransitionAccountStatus } from "@/lib/accountLifecycle";

describe("authoritative account lifecycle transitions", () => {
  it.each([
    ["inactive", "active"],
    ["active", "suspended"],
    ["suspended", "active"],
    ["active", "breached"],
    ["active", "expired"],
    ["active", "closed"],
    ["breached", "closed"],
    ["expired", "closed"],
  ])("allows %s -> %s", (current, next) => {
    expect(canTransitionAccountStatus(current, next)).toBe(true);
  });

  it.each([
    ["closed", "active"],
    ["closed", "suspended"],
    ["breached", "active"],
    ["expired", "active"],
    ["active", "active"],
    ["unknown", "active"],
  ])("rejects %s -> %s", (current, next) => {
    expect(canTransitionAccountStatus(current, next)).toBe(false);
  });
});