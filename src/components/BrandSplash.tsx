export function BrandSplash() {
  return (
    <main
      role="status"
      aria-live="polite"
      className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#070b14] px-4 text-center"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.12),transparent_58%)]"
      />
      <div className="relative flex w-full max-w-md flex-col items-center">
        <div className="relative mb-6 flex h-28 w-28 items-center justify-center sm:mb-7 sm:h-32 sm:w-32">
          <div
            aria-hidden="true"
            className="absolute inset-2 rounded-full bg-blue-500/15 blur-2xl"
          />
          <img
            src="/brand-logo-original.png"
            alt="FundedWealth"
            className="relative h-full w-full object-contain drop-shadow-[0_0_22px_rgba(56,189,248,0.3)]"
          />
        </div>
        <h1 className="bg-gradient-to-r from-sky-300 via-cyan-200 to-blue-300 bg-clip-text text-xl font-bold tracking-[0.18em] text-transparent sm:text-2xl sm:tracking-[0.22em]">
          FUNDEDWEALTH
        </h1>
        <p className="mt-2 text-sm font-medium uppercase tracking-[0.32em] text-slate-100/85 sm:text-base">
          Terminal
        </p>
        <div className="mt-8 flex items-center gap-3 text-sm text-slate-300/80">
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border border-sky-200/25 border-t-cyan-300 motion-reduce:animate-none"
          />
          <span>Connecting...</span>
        </div>
      </div>
    </main>
  );
}
