import { Check, WalletCards } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAccountContext } from "@/hooks/useAccountContext";
import { toast } from "sonner";

function formatCurrency(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedCurrency(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${formatCurrency(Math.abs(value))}`;
}

function statusClass(status: string) {
  if (status === "ACTIVE") return "border-bullish/50 bg-bullish/10 text-bullish";
  if (status === "NO ACCOUNT") return "border-border bg-muted/40 text-muted-foreground";
  if (status === "WARNING") return "border-warning/50 bg-warning/10 text-warning";
  return "border-bearish/50 bg-bearish/10 text-bearish";
}

export function TradingAccountBar() {
  const {
    accounts,
    accountContext,
    activeAccountId,
    isLoading,
    isError,
    hasNoAccount,
    selectAccount,
  } = useAccountContext();

  const hasAccount = Boolean(accountContext);
  const account = accountContext?.account;
  const risk = accountContext?.risk_state;
  const rules = accountContext?.rules;
  const accountStatus = hasNoAccount
    ? "NO ACCOUNT"
    : String(account?.status === "active" ? risk?.status ?? account.status : account?.status ?? risk?.status ?? "UNAVAILABLE").toUpperCase();
  const statusDotClass = accountStatus === "ACTIVE"
    ? "bg-bullish"
    : accountStatus === "NO ACCOUNT" || accountStatus === "UNAVAILABLE"
      ? "bg-muted-foreground"
      : accountStatus === "WARNING"
        ? "bg-warning"
        : "bg-bearish";
  const emptyValue = hasNoAccount ? "00" : "—";
  const accountType = hasNoAccount
    ? "00"
    : String(account?.account_type ?? account?.challenge_type ?? accountContext?.product.name ?? "—").replace(/[_-]+/g, " ");

  const metrics = [
    ["Account Type", accountType],
    ["Balance", hasAccount ? formatCurrency(account?.current_balance) : emptyValue],
    ["Equity", hasAccount ? formatCurrency(account?.equity) : emptyValue],
    ["Available Funds", hasAccount ? formatCurrency(account?.available_margin) : emptyValue],
    ["Total P&L", hasAccount ? formatSignedCurrency(risk?.profit_current) : emptyValue],
    ["Daily Loss", hasAccount ? `${formatCurrency(risk?.daily_loss)} / ${formatCurrency(rules?.daily_loss_limit)}` : emptyValue],
    ["Max Drawdown", hasAccount ? `${formatCurrency(risk?.drawdown_amount)} / ${formatCurrency(rules?.maximum_drawdown)}` : emptyValue],
    ["Profit Target", hasAccount
      ? risk?.profit_target == null ? "—" : `${formatCurrency(risk.profit_current)} / ${formatCurrency(risk.profit_target)}`
      : emptyValue],
    ["Open Risk Events", hasAccount ? String(risk?.open_events ?? "—") : emptyValue],
  ];
  const selectedAccount = accounts.find((item) => item.id === activeAccountId);

  return (
    <section
      className="mb-3 overflow-x-auto rounded-lg border border-border/70 bg-card/70 px-3 py-2"
      aria-label="Trading account context bar"
      aria-busy={isLoading}
    >
      <div className="flex min-w-[1180px] items-center">
        <div className="flex min-w-[150px] items-center gap-2 pr-3">
          <WalletCards className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {accounts.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-7 min-w-0 gap-1.5 px-1.5 text-left text-[10px] font-semibold hover:bg-primary/5">
                  <span className="max-w-[9rem] truncate">{selectedAccount?.account_code || "Trading Accounts"}</span>
                  <span className="shrink-0 text-[9px] text-muted-foreground">▼</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80 p-0">
                <DropdownMenuLabel className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Trading Accounts ({accounts.length})</span>
                  <WalletCards className="h-3.5 w-3.5" />
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="m-0" />
                <DropdownMenuRadioGroup
                  value={activeAccountId ?? ""}
                  onValueChange={(value) => {
                    void selectAccount(value).catch((error: unknown) => {
                      toast.error(error instanceof Error ? error.message : "Unable to switch trading account.");
                    });
                  }}
                  className="p-1.5"
                >
                  {accounts.map((item) => (
                    <DropdownMenuRadioItem key={item.id} value={item.id} className="items-start gap-2 py-2.5 pl-8 pr-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold">{item.account_code || item.id.slice(0, 8)}</span>
                          {item.id === activeAccountId && <Check className="h-3.5 w-3.5 text-primary" />}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{item.status}</span>
                          <span>{formatCurrency(item.balance)}</span>
                        </div>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {selectedAccount?.account_code ?? (hasNoAccount ? "Trading Account" : "Account Context")}
              </p>
              {selectedAccount && <p className="text-[9px] text-muted-foreground">{selectedAccount.status}</p>}
            </div>
          )}
        </div>
        {metrics.map(([label, value], index) => (
          <div key={label} className={`min-w-0 flex-1 px-2 ${index > 0 ? "border-l border-border/70" : "border-l border-border/70"}`}>
            <p className="whitespace-nowrap text-[9px] leading-3 uppercase text-muted-foreground">{label}</p>
            <p className={`whitespace-nowrap font-mono text-xs leading-4 tabular-nums ${label === "Total P&L" && typeof risk?.profit_current === "number" ? risk.profit_current >= 0 ? "text-bullish" : "text-bearish" : ""}`}>
              {value}
            </p>
          </div>
        ))}
        <div className="shrink-0 border-l border-border/70 pl-3">
          <p className="mb-0.5 text-[9px] leading-3 uppercase text-muted-foreground">Status</p>
          <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-semibold tracking-wide ${statusClass(accountStatus)}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />
            {accountStatus}
          </span>
        </div>
        {isError && !hasNoAccount && (
          <span className="ml-3 text-[10px] text-muted-foreground">Account details unavailable</span>
        )}
      </div>
    </section>
  );
}
