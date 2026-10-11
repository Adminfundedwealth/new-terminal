import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrandSplash } from "@/components/BrandSplash";
import { supabase } from "@/integrations/supabase/client";
import { setActiveAccount } from "@/lib/terminalApi";

let completionAttempt: Promise<void> | null = null;

async function completeTerminalSso() {
  const response = await fetch("/auth/sso/exchange", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("This sign-in handoff is invalid or has expired. Launch the terminal again.");

  const exchange = await response.json() as { tokenHash?: string; accountId?: string };
  if (!exchange.tokenHash || !exchange.accountId) {
    throw new Error("The terminal returned an incomplete sign-in handoff. Launch the terminal again.");
  }

  const { error } = await supabase.auth.verifyOtp({
    token_hash: exchange.tokenHash,
    type: "magiclink",
  });
  if (error) throw new Error("The terminal could not verify the one-time sign-in. Launch the terminal again.");

  await setActiveAccount(exchange.accountId);
}

export default function TerminalSsoComplete() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    completionAttempt ??= completeTerminalSso();
    let mounted = true;
    void completionAttempt.then(
      () => {
        if (mounted) navigate("/", { replace: true });
      },
      (reason: unknown) => {
        if (mounted) setError(reason instanceof Error ? reason.message : "Terminal sign-in failed.");
      },
    );
    return () => {
      mounted = false;
    };
  }, [navigate]);

  if (!error) return <BrandSplash />;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0f1016] px-6 text-center text-slate-100">
      <h1 className="text-xl font-semibold">Terminal sign-in failed</h1>
      <p role="alert" className="max-w-md text-sm text-slate-300">{error}</p>
      <button
        type="button"
        className="rounded-md border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
        onClick={() => navigate("/login", { replace: true })}
      >
        Continue to sign in
      </button>
    </main>
  );
}
