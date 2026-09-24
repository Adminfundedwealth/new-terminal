import { useState, useEffect, useCallback } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatusFooter } from "@/components/StatusFooter";
import { CommandPalette } from "@/components/CommandPalette";
import { AlertSystem } from "@/components/AlertSystem";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAuth } from "@/hooks/useAuth";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useLiveIndices, useMarketStatus, useAllIndices } from "@/hooks/useMarketData";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import { marketWS } from "@/lib/websocketClient";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  fetchTerminalDashboard,
  fetchTerminalExecutions,
  fetchTerminalPerformance,
  fetchTerminalPositions,
  fetchTerminalRisk,
  fetchTerminalWatchlists,
} from "@/lib/terminalApi";
import { Search, Bell, Timer, RefreshCw, Wifi, WifiOff, Plane, WalletCards, Check, LogOut } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function DashboardLayout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [timeToExpiry, setTimeToExpiry] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { accounts: tradingAccounts, accountContext, activeAccountId, isLoading: accountLoading, isError: accountError, selectAccount } = useAccountContext();

  useEffect(() => {
    marketWS.start();
    return () => marketWS.stop();
  }, []);

  useQueries({
    queries: [
      { queryKey: ["terminal-os", user?.id ?? "anonymous", "dashboard", activeAccountId], queryFn: () => fetchTerminalDashboard(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId) },
      { queryKey: ["terminal-os", user?.id ?? "anonymous", "positions", activeAccountId], queryFn: () => fetchTerminalPositions(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId) },
      { queryKey: ["terminal-os", user?.id ?? "anonymous", "executions", activeAccountId], queryFn: () => fetchTerminalExecutions(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId) },
      { queryKey: ["terminal-os", user?.id ?? "anonymous", "risk", activeAccountId], queryFn: () => fetchTerminalRisk(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId) },
      { queryKey: ["terminal-os", user?.id ?? "anonymous", "performance", activeAccountId], queryFn: () => fetchTerminalPerformance(activeAccountId ?? undefined), retry: false, staleTime: 30_000, enabled: Boolean(activeAccountId) },
      { queryKey: ["terminal-os", user?.id ?? "anonymous", "watchlists", activeAccountId], queryFn: fetchTerminalWatchlists, retry: false, staleTime: 30_000, enabled: Boolean(user?.id) },
    ],
  });

  const handleAccountChange = (accountId: string) => { void selectAccount(accountId); };

  const handleSignOut = async () => {
    await signOut();
  };

  // Live data hooks
  const { data: indicesResult } = useLiveIndices();
  const { data: marketResult } = useMarketStatus();
  const { data: allIndicesData } = useAllIndices();
  const hasLiveTicks = useWebSocketStatus();

  const indices = indicesResult?.data || [];
  const isMarketOpen = marketResult?.isOpen || false;
  const isLiveData = Boolean(hasLiveTicks && isMarketOpen);
  const dataStatus = isLiveData ? "LIVE" : isMarketOpen ? "CONNECTED" : indicesResult?.isLive ? "CLOSED" : "OFFLINE";
  const giftNifty = marketResult?.giftNifty || null;
  const liveVix = allIndicesData?.vix;

  useKeyboardShortcuts({
    onToggleSearch: () => setSearchOpen(true),
    onToggleAlerts: () => setAlertsOpen(true),
  });

  // Quick refresh — invalidate ALL queries
  const handleQuickRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    setLastRefresh(new Date());
    setTimeout(() => setIsRefreshing(false), 800);
  }, [queryClient]);

  // Keyboard shortcut: R for refresh
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        handleQuickRefresh();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleQuickRefresh]);

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const target = new Date(now);
      target.setHours(15, 30, 0, 0);
      const dayOfWeek = now.getDay();
      const daysUntilThursday = ((4 - dayOfWeek) + 7) % 7 || 7;
      if (!(dayOfWeek === 4 && now < target)) {
        target.setDate(target.getDate() + daysUntilThursday);
      }
      const diff = target.getTime() - now.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeToExpiry(`${days}d ${hours}h ${mins}m`);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,hsl(var(--primary)/0.035)_0%,transparent_22rem),linear-gradient(90deg,hsl(var(--primary)/0.025)_0%,transparent_36rem)] pointer-events-none" />
        <div className="bg-noise" />

        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {/* Top Bar */}
          <header className="min-h-11 flex items-center border-b border-border/70 px-2.5 sm:px-3 shrink-0 bg-background/92 backdrop-blur-xl transition-colors">
            <SidebarTrigger className="mr-2 h-6 w-6" />

            {/* Live Ticker — real-time from useLiveIndices */}
            <div className="hidden xl:flex items-center gap-4 overflow-hidden flex-1 mr-2">
              {indices.slice(0, 4).map((idx: any) => {
                const pos = idx.change >= 0;
                return (
                  <div key={idx.symbol} className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{idx.symbol}</span>
                    <span className="text-xs font-mono font-semibold tabular-nums">{idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                    <span className={`text-xs font-mono font-medium tabular-nums ${pos ? "text-bullish" : "text-bearish"}`}>
                      {pos ? "+" : ""}{idx.changePercent.toFixed(2)}%
                    </span>
                  </div>
                );
              })}

              {/* VIX */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">VIX</span>
                <span className={`text-xs font-mono font-semibold tabular-nums ${(liveVix?.changePercent ?? 0) >= 0 ? "text-bearish" : "text-bullish"}`}>
                  {liveVix ? liveVix.value.toFixed(2) : "--"}
                </span>
                {liveVix && (
                  <span className={`text-xs font-mono font-medium tabular-nums ${liveVix.changePercent >= 0 ? "text-bearish" : "text-bullish"}`}>
                    {liveVix.changePercent >= 0 ? "+" : ""}{liveVix.changePercent.toFixed(2)}%
                  </span>
                )}
              </div>

              {/* GIFT Nifty — shown when available */}
              {giftNifty && giftNifty.lastPrice > 0 && (
                <div className="flex items-center gap-1.5 shrink-0 px-1.5 py-0.5 rounded bg-primary/5 border border-primary/10">
                  <Plane className="h-3 w-3 text-primary" />
                  <span className="text-xs text-primary font-medium uppercase tracking-wider">GIFT</span>
                  <span className="text-xs font-mono font-semibold tabular-nums">{giftNifty.lastPrice.toLocaleString("en-IN")}</span>
                  <span className={`text-xs font-mono font-medium tabular-nums ${giftNifty.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {giftNifty.change >= 0 ? "+" : ""}{giftNifty.change.toFixed(0)}
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1 shrink-0 ml-auto">
              {/* Data source badge — CLICKABLE with status popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className={`flex items-center gap-1.5 h-7 px-2 rounded-md border text-xs font-semibold transition-all cursor-pointer hover:opacity-90 ${
                    isLiveData
                      ? "border-bullish/50 text-bullish bg-bullish/5"
                      : "border-muted-foreground/30 text-muted-foreground bg-muted/30"
                  }`}>
                    {isLiveData ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                    <span className="hidden sm:inline">{dataStatus}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="end">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${isLiveData ? "bg-bullish animate-pulse" : "bg-muted-foreground/50"}`} />
                      <p className="text-xs font-semibold">{dataStatus === "LIVE" ? "Live ticks receiving" : dataStatus === "CLOSED" ? "Broker connected · Market closed" : dataStatus === "CONNECTED" ? "Broker connected · Awaiting ticks" : "Data unavailable"}</p>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Last Refresh</span>
                        <span className="font-mono">{lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              <div className="hidden sm:block w-px h-4 bg-border mx-0.5" />

              {/* Expiry Timer */}
              <div className="hidden sm:flex items-center gap-1 px-1.5">
                <Timer className="h-3 w-3 text-warning" />
                <span className="text-xs font-mono text-warning tabular-nums">{timeToExpiry}</span>
              </div>

              <div className="hidden sm:block w-px h-4 bg-border mx-0.5" />

              {/* Refresh */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/5" onClick={handleQuickRefresh}>
                    <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Refresh <kbd className="ml-1 text-xs font-mono bg-muted px-1 rounded">R</kbd></TooltipContent>
              </Tooltip>

              {/* Search */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/5" onClick={() => setSearchOpen(true)}>
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Search <kbd className="ml-1 text-xs font-mono bg-muted px-1 rounded">⌘K</kbd></TooltipContent>
              </Tooltip>

              {/* Alerts */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 relative hover:bg-primary/5" onClick={() => setAlertsOpen(true)}>
                    <Bell className="h-3.5 w-3.5" />
                    <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Alerts</TooltipContent>
              </Tooltip>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-7 gap-1.5 px-2 text-xs font-semibold hover:bg-primary/5">
                    <WalletCards className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">Trading Accounts</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 p-0">
                  <DropdownMenuLabel className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <span>Trading Accounts ({tradingAccounts.length})</span>
                    <WalletCards className="h-3.5 w-3.5" />
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="m-0" />
                  {tradingAccounts.length > 0 ? (
                    <DropdownMenuRadioGroup value={activeAccountId ?? ""} onValueChange={handleAccountChange} className="p-1.5">
                      {tradingAccounts.map((account) => (
                        <DropdownMenuRadioItem key={account.id} value={account.id} className="items-start gap-2 py-2.5 pl-8 pr-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-semibold">{account.account_code || account.id.slice(0, 8)}</span>
                              {account.status === "active" && <Check className="h-3.5 w-3.5 text-primary" />}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{account.status}</span>
                              <span>₹{account.balance.toLocaleString("en-IN")}</span>
                            </div>
                          </div>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  ) : accountLoading ? (
                    <div className="px-3 py-5 text-center">
                      <WalletCards className="mx-auto h-5 w-5 animate-pulse text-muted-foreground/50" />
                      <p className="mt-2 text-xs font-semibold">Loading account context</p>
                    </div>
                  ) : accountError ? (
                    <div className="px-3 py-5 text-center">
                      <WalletCards className="mx-auto h-5 w-5 text-muted-foreground/50" />
                      <p className="mt-2 text-xs font-semibold">Account context unavailable</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Sign in to load your canonical accounts.</p>
                    </div>
                  ) : (
                    <div className="px-3 py-5 text-center">
                      <WalletCards className="mx-auto h-5 w-5 text-muted-foreground/50" />
                      <p className="mt-2 text-xs font-semibold">No trading accounts connected</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Your linked accounts will appear here.</p>
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button aria-label={`Sign out ${user?.email ?? "account"}`} variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive" onClick={() => void handleSignOut()}>
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Sign out</TooltipContent>
              </Tooltip>

              <div className="w-px h-4 bg-border mx-0.5" />

              {/* Market Status */}
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <span className={`block h-1.5 w-1.5 rounded-full ${isMarketOpen ? "bg-bullish" : "bg-muted-foreground/50"}`} />
                  {isMarketOpen && <span className="absolute inset-0 h-1.5 w-1.5 rounded-full bg-bullish animate-ping opacity-50" />}
                </div>
                <span className="hidden sm:inline text-xs text-muted-foreground font-medium tracking-wide">
                  {isMarketOpen ? "LIVE" : "CLOSED"}
                </span>
              </div>
              <span className="hidden md:inline text-xs text-muted-foreground font-mono tabular-nums ml-1">
                {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-2.5 sm:p-3 lg:p-4 pb-14 sm:pb-12">
            {accountContext && (
              <section className="mb-3 grid gap-2 rounded-lg border border-border/70 bg-card/70 p-3 sm:grid-cols-4" aria-label="Server-authoritative account risk context">
                <div className="sm:col-span-4 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Account risk context</h2>
                    <p className="text-[11px] text-muted-foreground">Server-resolved rules and risk state. No order execution is performed.</p>
                  </div>
                  <span className="rounded border border-border px-2 py-1 text-[10px] font-semibold tracking-wide">{accountContext.risk_state.status ?? "UNKNOWN"}</span>
                </div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Daily loss</p><p className="font-mono text-sm">{accountContext.risk_state.daily_loss == null ? "--" : accountContext.risk_state.daily_loss.toFixed(2)}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Drawdown</p><p className="font-mono text-sm">{accountContext.risk_state.drawdown_amount == null ? "--" : accountContext.risk_state.drawdown_amount.toFixed(2)}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Profit target</p><p className="font-mono text-sm">{accountContext.risk_state.profit_target == null ? "--" : accountContext.risk_state.profit_target.toFixed(2)}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Open risk events</p><p className="font-mono text-sm">{accountContext.risk_state.open_events}</p></div>
              </section>
            )}
            <div className="page-transition" key={location.pathname}>
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <AlertSystem open={alertsOpen} onOpenChange={setAlertsOpen} />
      <StatusFooter />
    </SidebarProvider>
  );
}
