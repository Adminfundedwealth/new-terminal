import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import DashboardLayout from "@/components/DashboardLayout";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Login from "./pages/Login";

// Route-based code splitting for optimal initial load
const Index = lazy(() => import("./pages/Index"));
const OptionChain = lazy(() => import("./pages/OptionChain"));
const Futures = lazy(() => import("./pages/Futures"));
const InstrumentDirectory = lazy(() => import("./pages/InstrumentDirectory"));
const OIAnalysis = lazy(() => import("./pages/OIAnalysis"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Stocks = lazy(() => import("./pages/Stocks"));
const Indices = lazy(() => import("./pages/Indices"));
const StrategyBuilder = lazy(() => import("./pages/StrategyBuilder"));
const PositionTracker = lazy(() => import("./pages/PositionTracker"));
const Calendar = lazy(() => import("./pages/Calendar"));
const MarketNews = lazy(() => import("./pages/MarketNews"));
const BrokerSettings = lazy(() => import("./pages/BrokerSettings"));
const NotFound = lazy(() => import("./pages/NotFound"));

function ProtectedLayout() {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <DashboardSkeleton />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <DashboardLayout />;
}

const queryClient = new QueryClient();

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <ErrorBoundary fallbackMessage="This page encountered an error. Try refreshing.">
        {children}
      </ErrorBoundary>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedLayout />}>
            <Route path="/" element={<PageSuspense><Index /></PageSuspense>} />
              <Route path="/stocks" element={<PageSuspense><Stocks /></PageSuspense>} />
              <Route path="/indices" element={<PageSuspense><Indices /></PageSuspense>} />
            <Route path="/option-chain" element={<PageSuspense><OptionChain /></PageSuspense>} />
            <Route path="/options" element={<PageSuspense><OptionChain /></PageSuspense>} />
              <Route path="/index-stocks" element={<PageSuspense><InstrumentDirectory category="indices" /></PageSuspense>} />
            <Route path="/futures" element={<PageSuspense><Futures /></PageSuspense>} />
            <Route path="/oi-analysis" element={<PageSuspense><OIAnalysis /></PageSuspense>} />
            <Route path="/watchlist" element={<PageSuspense><Watchlist /></PageSuspense>} />
            <Route path="/strategy-builder" element={<PageSuspense><StrategyBuilder /></PageSuspense>} />
            <Route path="/position-tracker" element={<PageSuspense><PositionTracker /></PageSuspense>} />
            <Route path="/calendar" element={<PageSuspense><Calendar /></PageSuspense>} />
            <Route path="/market-news" element={<PageSuspense><MarketNews /></PageSuspense>} />
            <Route path="/broker-settings" element={<PageSuspense><BrokerSettings /></PageSuspense>} />
            </Route>
            <Route path="*" element={<Suspense fallback={null}><NotFound /></Suspense>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

