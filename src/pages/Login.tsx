import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

export default function Login() {
  const { configured, loading, user, signIn, signUp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Checking session...</main>;
  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from || "/"} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      if (mode === "sign-in") {
        await signIn(email, password);
        navigate("/", { replace: true });
      } else {
        await signUp(email, password);
        setMessage("Account created. Check your email if confirmation is enabled, then sign in.");
        setMode("sign-in");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">FundedWealth Terminal</p>
          <h1 className="mt-2 text-2xl font-semibold">{mode === "sign-in" ? "Sign in" : "Create account"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your New Terminal Supabase account.</p>
        </div>
        {!configured && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Supabase is not configured for this localhost instance.</p>}
        {error && <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="mb-4 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">{message}</p>}
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          <Button className="w-full" disabled={!configured || submitting}>{submitting ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}</Button>
        </form>
        <button type="button" className="mt-4 w-full text-sm text-primary hover:underline" onClick={() => { setError(""); setMessage(""); setMode(mode === "sign-in" ? "sign-up" : "sign-in"); }}>
          {mode === "sign-in" ? "Need a local test account? Create one" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}