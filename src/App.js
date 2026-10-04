import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
const RuleCatalog = lazy(() => import("./pages/RuleCatalog"));
const RealtimeMockE2E = lazy(() => import("./pages/RealtimeMockE2E"));
const NotFound = lazy(() => import("./pages/NotFound"));
function ProtectedLayout() {
    const { loading, user } = useAuth();
    const location = useLocation();
    if (loading)
        return _jsx(DashboardSkeleton, {});
    if (!user)
        return _jsx(Navigate, { to: "/login", replace: true, state: { from: location.pathname } });
    return _jsx(DashboardLayout, {});
}
const queryClient = new QueryClient();
function PageSuspense({ children }) {
    return (_jsx(Suspense, { fallback: _jsx(DashboardSkeleton, {}), children: _jsx(ErrorBoundary, { fallbackMessage: "This page encountered an error. Try refreshing.", children: children }) }));
}
const App = () => (_jsx(QueryClientProvider, { client: queryClient, children: _jsxs(TooltipProvider, { children: [_jsx(Toaster, {}), _jsx(Sonner, {}), _jsx(AuthProvider, { children: _jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(Login, {}) }), _jsxs(Route, { element: _jsx(ProtectedLayout, {}), children: [_jsx(Route, { path: "/", element: _jsx(PageSuspense, { children: _jsx(Index, {}) }) }), _jsx(Route, { path: "/stocks", element: _jsx(PageSuspense, { children: _jsx(Stocks, {}) }) }), _jsx(Route, { path: "/indices", element: _jsx(PageSuspense, { children: _jsx(Indices, {}) }) }), _jsx(Route, { path: "/option-chain", element: _jsx(PageSuspense, { children: _jsx(OptionChain, {}) }) }), _jsx(Route, { path: "/options", element: _jsx(PageSuspense, { children: _jsx(OptionChain, {}) }) }), _jsx(Route, { path: "/index-stocks", element: _jsx(PageSuspense, { children: _jsx(InstrumentDirectory, { category: "indices" }) }) }), _jsx(Route, { path: "/futures", element: _jsx(PageSuspense, { children: _jsx(Futures, {}) }) }), _jsx(Route, { path: "/oi-analysis", element: _jsx(PageSuspense, { children: _jsx(OIAnalysis, {}) }) }), _jsx(Route, { path: "/watchlist", element: _jsx(PageSuspense, { children: _jsx(Watchlist, {}) }) }), _jsx(Route, { path: "/strategy-builder", element: _jsx(PageSuspense, { children: _jsx(StrategyBuilder, {}) }) }), _jsx(Route, { path: "/position-tracker", element: _jsx(PageSuspense, { children: _jsx(PositionTracker, {}) }) }), _jsx(Route, { path: "/calendar", element: _jsx(PageSuspense, { children: _jsx(Calendar, {}) }) }), _jsx(Route, { path: "/market-news", element: _jsx(PageSuspense, { children: _jsx(MarketNews, {}) }) }), _jsx(Route, { path: "/broker-settings", element: _jsx(PageSuspense, { children: _jsx(BrokerSettings, {}) }) }), _jsx(Route, { path: "/rules/catalog", element: _jsx(PageSuspense, { children: _jsx(RuleCatalog, {}) }) }), _jsx(Route, { path: "/__realtime-e2e", element: _jsx(PageSuspense, { children: _jsx(RealtimeMockE2E, {}) }) })] }), _jsx(Route, { path: "*", element: _jsx(Suspense, { fallback: null, children: _jsx(NotFound, {}) }) })] }) }) })] }) }));
export default App;
