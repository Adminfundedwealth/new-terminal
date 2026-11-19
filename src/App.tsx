import { lazy, Suspense, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrandSplash } from "@/components/BrandSplash";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import DashboardLayout from "@/components/DashboardLayout";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { clearChunkRecoveryAttempt } from "@/lib/chunkRecovery";

type PageLoader = () => Promise<{ default: React.ComponentType }>;

const loadIndex: PageLoader = () => import("./pages/Index");
const loadOptionChain: PageLoader = () => import("./pages/OptionChain");
const loadFutures: PageLoader = () => import("./pages/Futures");
const loadOIAnalysis: PageLoader = () => import("./pages/OIAnalysis");
const loadWatchlist: PageLoader = () => import("./pages/Watchlist");
const loadStocks: PageLoader = () => import("./pages/Stocks");
const loadIndices: PageLoader = () => import("./pages/Indices");
const loadStrategyBuilder: PageLoader = () => import("./pages/StrategyBuilder");
const loadPositionTracker: PageLoader = () => import("./pages/PositionTracker");
const loadCalendar: PageLoader = () => import("./pages/Calendar");
const loadMarketNews: PageLoader = () => import("./pages/MarketNews");
const loadBrokerSettings: PageLoader = () => import("./pages/BrokerSettings");
const loadMyStats: PageLoader = () => import("./pages/MyStats");
const loadNotFound: PageLoader = () => import("./pages/NotFound");
const loadLogin: PageLoader = () => import("./pages/Login");
const loadRealtimeMockE2E: PageLoader = () => import("./pages/RealtimeMockE2E");
const loadTerminalSsoComplete: PageLoader = () => import("./pages/TerminalSsoComplete");
const loadInstrumentDirectory: PageLoader = () =>
  import("./pages/InstrumentDirectory").then(({ default: InstrumentDirectory }) => ({
    default: () => <InstrumentDirectory category="indices" />,
  }));

const queryClient = new QueryClient();

function PageSuspense({
  load,
  fallback = <DashboardSkeleton />,
}: {
  load: PageLoader;
  fallback?: React.ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const Page = useMemo(
    () =>
      lazy(async () => {
        const page = await load();
        clearChunkRecoveryAttempt(window.sessionStorage);
        return page;
      }),
    [attempt, load],
  );

  return (
    <Suspense fallback={fallback}>
      <ErrorBoundary
        key={attempt}
        fallbackMessage="This page encountered an error. Try refreshing."
        onRecover={() => setAttempt((current) => current + 1)}
      >
        <Page />
      </ErrorBoundary>
    </Suspense>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <BrandSplash />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PageSuspense load={loadLogin} fallback={<BrandSplash />} />} />
            <Route path="/auth/sso/complete" element={<PageSuspense load={loadTerminalSsoComplete} fallback={<BrandSplash />} />} />
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<PageSuspense load={loadIndex} />} />
              <Route path="/stocks" element={<PageSuspense load={loadStocks} />} />
              <Route path="/indices" element={<PageSuspense load={loadIndices} />} />
              <Route path="/option-chain" element={<PageSuspense load={loadOptionChain} />} />
              <Route path="/options" element={<PageSuspense load={loadOptionChain} />} />
              <Route path="/index-stocks" element={<PageSuspense load={loadInstrumentDirectory} />} />
              <Route path="/futures" element={<PageSuspense load={loadFutures} />} />
              <Route path="/oi-analysis" element={<PageSuspense load={loadOIAnalysis} />} />
              <Route path="/calendar" element={<PageSuspense load={loadCalendar} />} />
              <Route path="/market-news" element={<PageSuspense load={loadMarketNews} />} />
            </Route>
            <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
              <Route path="/watchlist" element={<PageSuspense load={loadWatchlist} />} />
              <Route path="/strategy-builder" element={<PageSuspense load={loadStrategyBuilder} />} />
              <Route path="/position-tracker" element={<PageSuspense load={loadPositionTracker} />} />
              <Route path="/broker-settings" element={<PageSuspense load={loadBrokerSettings} />} />
              <Route path="/my-stats" element={<PageSuspense load={loadMyStats} />} />
              <Route path="/__realtime-e2e" element={<PageSuspense load={loadRealtimeMockE2E} />} />
            </Route>
            <Route path="*" element={<PageSuspense load={loadNotFound} fallback={null} />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
