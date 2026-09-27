export function resolveAllowedOrigin(origin) {
  if (!origin) return undefined;

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".localhost");

    if (!parsed.protocol.startsWith("http") || !isLocalHost) {
      return undefined;
    }

    return origin;
  } catch {
    return undefined;
  }
}
