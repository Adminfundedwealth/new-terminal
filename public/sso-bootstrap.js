(() => {
  const status = document.getElementById("sso-status");
  const token = document.querySelector("#sso-handoff input[name=token]")?.value;

  function fail(message) {
    status.textContent = message;
  }

  if (!token) {
    fail("The sign-in handoff is missing. Launch the terminal again.");
    return;
  }

  const handoff = new URLSearchParams({ token });
  fetch("https://new-terminal-production.up.railway.app/auth/sso/browser", {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: handoff,
  }).then(async (response) => {
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.tokenHash || !result?.accountId) {
      throw new Error(result?.error || "This sign-in handoff is invalid or has expired. Launch the terminal again.");
    }

    const exchange = new URLSearchParams({
      tokenHash: result.tokenHash,
      accountId: result.accountId,
    });
    const stored = await fetch("/sso-proxy.php?route=store", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: exchange,
    });
    if (!stored.ok) {
      throw new Error("The terminal sign-in session could not be created. Launch the terminal again.");
    }
    window.location.replace("/auth/sso/complete");
  }).catch((error) => {
    fail(error instanceof Error ? error.message : "Terminal sign-in failed. Launch the terminal again.");
  });
})();
