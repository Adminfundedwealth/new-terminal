import { FundedWealthBrand } from "@/components/FundedWealthBrand";

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
        <FundedWealthBrand />
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-300/80">
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border border-blue-400/25 border-t-blue-500 motion-reduce:animate-none"
          />
          <span>Connecting...</span>
        </div>
      </div>
    </main>
  );
}
