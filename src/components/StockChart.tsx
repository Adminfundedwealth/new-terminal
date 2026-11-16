import { useEffect, useRef, useState } from "react";
import { createWidget, type OrderRequest, type Widget } from "openalgo-charts/widget";
import "openalgo-charts/draw";
import "openalgo-charts/indicators";
import "openalgo-charts/transform";
import "openalgo-charts/workspace";
import { BarChart3, Check, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAccountContext } from "@/hooks/useAccountContext";
import { useIsDark } from "@/hooks/useIsDark";
import {
  createIndexedDbWorkspaceStorage,
  WorkspaceRepository,
} from "openalgo-charts/workspace";
import {
  FundedWealthOpenAlgoDataFeed,
  type OpenAlgoQuoteStatus,
} from "@/lib/openAlgoDataFeed";
import type { TerminalMarketDataInstrument } from "@/lib/terminalApi";

interface StockChartProps {
  symbol: string;
  selectedInstrument?: TerminalMarketDataInstrument;
  /** Inline mode renders directly, otherwise renders inside a Card. */
  inline?: boolean;
  /** Initial height in pixels for a non-filling chart. */
  height?: number;
  /** Fill the available inline container height. */
  fill?: boolean;
  /** Explain the chart's unavailable state in the host workspace. */
  unavailableMessage?: string;
  /** If provided, renders as a Sheet (drawer). */
  asSheet?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onBuy?: () => void;
  onSell?: () => void;
  onOrder?: (order: OrderRequest) => void;
}

function quoteStatusText(status: OpenAlgoQuoteStatus, message?: string): string {
  if (status === "live") return "Dhan quotes live";
  if (status === "stale") return message ?? "Market closed or the latest provider quote is stale.";
  if (status === "error") return `Quote updates unavailable · ${message ?? "provider error"}`;
  return "Connecting to Dhan quotes…";
}

function formatAccountBalance(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ChartAccountControl() {
  const {
    accounts,
    accountContext,
    activeAccountId,
    isLoading,
    hasNoAccount,
    selectAccount,
  } = useAccountContext();
  const selectedAccount = accounts.find((account) => account.id === activeAccountId);
  const accountLabel = selectedAccount?.account_code ?? (hasNoAccount ? "No account" : "Account unavailable");
  const balance = accountContext?.account.current_balance ?? selectedAccount?.balance;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[10px]"
          aria-label={`FundedWealth account ${accountLabel}, balance ${formatAccountBalance(balance)}`}
          aria-busy={isLoading}
        >
          <WalletCards className="h-3 w-3" />
          <span>Account</span>
          <span className="max-w-24 truncate font-medium">{accountLabel}</span>
          <span className="font-mono">{formatAccountBalance(balance)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>FundedWealth trading accounts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.length > 0 ? (
          <DropdownMenuRadioGroup
            value={activeAccountId ?? ""}
            onValueChange={(accountId) => {
              void selectAccount(accountId).catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : "Unable to switch trading account.");
              });
            }}
          >
            {accounts.map((account) => (
              <DropdownMenuRadioItem key={account.id} value={account.id} className="items-start py-2">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{account.account_code ?? account.id.slice(0, 8)}</span>
                    {account.id === activeAccountId && <Check className="h-3.5 w-3.5 text-primary" />}
                  </span>
                  <span className="mt-1 flex justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>{account.status}</span>
                    <span className="font-mono">{formatAccountBalance(account.id === activeAccountId ? balance : account.balance)}</span>
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {isLoading ? "Loading trading account…" : hasNoAccount ? "No trading account is available." : "Account details are unavailable."}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OpenAlgoChart({
  symbol,
  selectedInstrument,
  height,
  fill,
  unavailableMessage,
  onBuy,
  onSell,
  onOrder,
}: {
  symbol: string;
  selectedInstrument?: TerminalMarketDataInstrument;
  height: number;
  fill: boolean;
  unavailableMessage?: string;
  onBuy?: () => void;
  onSell?: () => void;
  onOrder?: (order: OrderRequest) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<Widget | null>(null);
  const feedRef = useRef<FundedWealthOpenAlgoDataFeed | null>(null);
  const onOrderRef = useRef(onOrder);
  onOrderRef.current = onOrder;
  const initialSelection = useRef({
    symbol: selectedInstrument?.tradingSymbol ?? symbol,
    exchange: selectedInstrument?.exchange ?? "",
    instrument: selectedInstrument,
  });
  const selectionKey = [
    selectedInstrument?.providerInstrumentId ?? "",
    selectedInstrument?.exchange ?? "",
    selectedInstrument?.tradingSymbol ?? symbol,
  ].join("\u001f");
  const previousSelectionKey = useRef(selectionKey);
  const isDark = useIsDark();
  const initialTheme = useRef(isDark ? "dark" : "light");
  const [quoteStatus, setQuoteStatus] = useState("Connecting to Dhan quotes…");
  const [mountError, setMountError] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let active = true;
    let widget: Widget | null = null;
    let feed: FundedWealthOpenAlgoDataFeed | null = null;
    try {
      feed = new FundedWealthOpenAlgoDataFeed(initialSelection.current.instrument, (status, message) => {
        if (!active) return;
        setQuoteStatus(quoteStatusText(status, message));
        setQuoteError(status === "error");
      });
      feedRef.current = feed;
      const workspaceStorage = createIndexedDbWorkspaceStorage(
        window.indexedDB,
        "fundedwealth-openalgo-workspaces",
      );
      const workspaces = new WorkspaceRepository(workspaceStorage, "primary");
      widget = createWidget(container, {
        feed: feed.feed,
        symbol: initialSelection.current.symbol,
        exchange: initialSelection.current.exchange,
        interval: "1d",
        theme: initialTheme.current,
        branding: false,
        topbar: true,
        indicators: true,
        panels: true,
        rail: true,
        drawingToolbar: true,
        persist: "fundedwealth-openalgo",
        workspaces,
        lookbackBars: 500,
        ...(onOrderRef.current
          ? { onOrder: (order: OrderRequest) => onOrderRef.current?.(order) }
          : {}),
      });
      widgetRef.current = widget;
      void widget.ready.then(() => {
        if (active && initialSelection.current.symbol) {
          widget?.setSymbol(initialSelection.current.symbol, initialSelection.current.exchange);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The OpenAlgo chart could not be initialized.";
      setMountError(message);
      setQuoteError(true);
    }

    return () => {
      active = false;
      widget?.destroy();
      feed?.destroy();
      widgetRef.current = null;
      feedRef.current = null;
    };
  }, []);

  useEffect(() => {
    widgetRef.current?.setTheme(isDark ? "dark" : "light");
  }, [isDark]);

  useEffect(() => {
    if (previousSelectionKey.current === selectionKey) return;
    previousSelectionKey.current = selectionKey;
    try {
      if (selectedInstrument) feedRef.current?.registerInstrument(selectedInstrument);
      widgetRef.current?.setSymbol(
        selectedInstrument?.tradingSymbol ?? symbol,
        selectedInstrument?.exchange ?? "",
      );
      setMountError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The selected instrument is not supported.";
      setMountError(message);
      setQuoteError(true);
    }
  }, [selectionKey, selectedInstrument, symbol]);

  return (
    <div className={`flex w-full flex-col ${fill ? "h-full min-h-[360px]" : ""}`}>
      <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
        <span className="truncate">
          FundedWealth · {selectedInstrument?.tradingSymbol ?? symbol} · Indian market data
        </span>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {onBuy && (
            <Button
              type="button"
              size="sm"
              className="h-7 bg-emerald-600 px-2 text-[10px] text-white hover:bg-emerald-700"
              onClick={onBuy}
            >
              Buy
            </Button>
          )}
          {onSell && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-[10px]"
              onClick={onSell}
            >
              Sell
            </Button>
          )}
          <ChartAccountControl />
          <Badge
            variant="outline"
            className={`shrink-0 px-1.5 py-0 text-[9px] ${quoteError ? "border-destructive/40 text-destructive" : ""}`}
            role="status"
            aria-live="polite"
          >
            {quoteStatus}
          </Badge>
        </div>
      </div>
      {mountError && (
        <div role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">
          {mountError}
        </div>
      )}
      {!mountError && unavailableMessage && (
        <div className="sr-only" aria-live="polite">{unavailableMessage}</div>
      )}
      <div
        ref={containerRef}
        className={`w-full min-h-0 flex-1 overflow-hidden ${fill ? "" : "rounded-b-lg"}`}
        style={fill ? undefined : { height }}
        data-testid="openalgo-chart-widget"
      />
    </div>
  );
}

export function StockChart({
  symbol,
  selectedInstrument,
  inline = false,
  height = 340,
  fill = false,
  unavailableMessage,
  asSheet = false,
  open = false,
  onOpenChange,
  onBuy,
  onSell,
  onOrder,
}: StockChartProps) {
  if (asSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[520px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              {symbol} — Chart
            </SheetTitle>
          </SheetHeader>
          <div className="mt-3 h-[430px] min-h-0">
            <OpenAlgoChart
              symbol={symbol}
              selectedInstrument={selectedInstrument}
              height={430}
              fill
              unavailableMessage={unavailableMessage}
              onBuy={onBuy}
              onSell={onSell}
              onOrder={onOrder}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (inline) {
    return (
      <OpenAlgoChart
        symbol={symbol}
        selectedInstrument={selectedInstrument}
        height={height}
        fill={fill}
        unavailableMessage={unavailableMessage}
        onBuy={onBuy}
        onSell={onSell}
        onOrder={onOrder}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4 text-primary" />
          {symbol} — OpenAlgo Chart
        </CardTitle>
      </CardHeader>
      <CardContent>
        <OpenAlgoChart
          symbol={symbol}
          selectedInstrument={selectedInstrument}
          height={height}
          fill={false}
          unavailableMessage={unavailableMessage}
          onBuy={onBuy}
          onSell={onSell}
          onOrder={onOrder}
        />
      </CardContent>
    </Card>
  );
}
