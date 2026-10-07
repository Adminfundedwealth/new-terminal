import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandSplash } from "@/components/BrandSplash";
import { FundedWealthBrand } from "@/components/FundedWealthBrand";
import { useAuth } from "@/hooks/useAuth";

export default function Login() {
  const { configured, loading, user, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <BrandSplash />;
  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from || "/"} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      navigate("/", { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#0f1016] px-4 py-10 text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgba(37,99,235,0.12),transparent_52%)]"
      />
      <div className="relative flex w-full max-w-sm flex-col items-center">
        <FundedWealthBrand />
        <section className="mt-8 w-full rounded-2xl border border-white/10 bg-[#151821]/90 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.3)] sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Sign in</h1>
          </div>
          {!configured && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Supabase is not configured for this localhost instance.</p>}
          {error && <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="email" className="text-slate-300">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="border-white/10 bg-[#0f1118] text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/50" /></div>
            <div className="space-y-2"><Label htmlFor="password" className="text-slate-300">Password</Label><Input id="password" type="password" autoComplete="current-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} className="border-white/10 bg-[#0f1118] text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/50" /></div>
            <Button className="w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500 text-white hover:brightness-110" disabled={!configured || submitting}>{submitting ? "Working..." : "Sign in"}</Button>
          </form>
        </section>
      </div>
    </main>
  );
}