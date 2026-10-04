const endpoint = process.env.D6_HEALTHCHECK_URL;
const timeoutMs = Number(process.env.D6_HEALTHCHECK_TIMEOUT_MS ?? 5_000);

if (!endpoint) {
  console.error(JSON.stringify({ status: "failed", error: "D6_HEALTHCHECK_URL is required" }));
  process.exit(1);
}

let url;
try {
  url = new URL(endpoint);
  if (!(["http:", "https:"].includes(url.protocol))) throw new Error("Unsupported protocol");
} catch {
  console.error(JSON.stringify({ status: "failed", error: "D6_HEALTHCHECK_URL must be a valid HTTP(S) URL" }));
  process.exit(1);
}

if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
  console.error(JSON.stringify({ status: "failed", error: "D6_HEALTHCHECK_TIMEOUT_MS must be positive" }));
  process.exit(1);
}

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
  console.log(JSON.stringify({ status: "ok", http_status: response.status, endpoint: url.origin + url.pathname }));
} catch (error) {
  const message = error instanceof Error ? error.message : "Health check failed";
  console.error(JSON.stringify({ status: "failed", endpoint: url.origin + url.pathname, error: message }));
  process.exitCode = 1;
}