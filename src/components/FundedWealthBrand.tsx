export function FundedWealthBrand() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-3 flex h-14 w-14 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-1 rounded-xl bg-violet-500/25 blur-lg"
        />
        <img
          src="/brand-logo-original.png"
          alt="FundedWealth logo"
          className="relative h-full w-full object-contain drop-shadow-[0_0_14px_rgba(139,92,246,0.32)]"
        />
      </div>
      <p className="bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400 bg-clip-text text-[13px] font-bold tracking-[0.08em] text-transparent">
        FUNDEDWEALTH
      </p>
      <p className="mt-0.5 text-[13px] font-semibold uppercase tracking-[0.32em] text-slate-100">
        Terminal
      </p>
    </div>
  );
}
