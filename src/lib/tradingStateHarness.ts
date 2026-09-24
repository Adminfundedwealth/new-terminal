export type HarnessSide = "BUY" | "SELL";
export type HarnessOrderStatus = "PENDING" | "OPEN" | "FILLED" | "UNKNOWN" | "RECONCILIATION_REQUIRED";

export interface HarnessAccount { id: string; balance: number; }
export interface HarnessOrder { id: string; account_id: string; symbol: string; side: HarnessSide; qty: number; price: number; status: HarnessOrderStatus; provider: string; idempotency_key: string; }
export interface HarnessExecution { id: string; account_id: string; order_id: string; position_id: string | null; symbol: string; side: HarnessSide; qty: number; price: number; }
export interface HarnessPosition { id: string; account_id: string; symbol: string; side: "LONG" | "SHORT"; qty: number; avg_price: number; current_price: number; realized_pnl: number; unrealized_pnl: number; is_open: boolean; }
export interface HarnessMetrics { account_id: string; realized_pnl: number; unrealized_pnl: number; ending_balance: number; total_trades: number; winning_trades: number; losing_trades: number; }
export interface HarnessRisk { account_id: string; status: "NORMAL" | "WARNING"; daily_loss: number; exposure: number; }

export class TradingStateHarness {
  readonly account: HarnessAccount;
  readonly orders = new Map<string, HarnessOrder>();
  readonly executions = new Map<string, HarnessExecution>();
  readonly positions = new Map<string, HarnessPosition>();

  constructor(account: HarnessAccount) { this.account = { ...account }; }

  createOrder(input: Omit<HarnessOrder, "status">): HarnessOrder {
    const existing = this.orders.get(input.idempotency_key);
    if (existing) return { ...existing };
    const order = { ...input, status: "PENDING" as const };
    this.orders.set(input.idempotency_key, order);
    return { ...order };
  }

  acceptOrder(orderId: string): HarnessOrder {
    const order = this.findOrder(orderId);
    order.status = "OPEN";
    return { ...order };
  }

  markUnknown(orderId: string): HarnessOrder {
    const order = this.findOrder(orderId);
    order.status = "RECONCILIATION_REQUIRED";
    return { ...order };
  }

  applyExecution(execution: Omit<HarnessExecution, "position_id">): HarnessExecution {
    const existing = this.executions.get(execution.id);
    if (existing) return { ...existing };
    const order = this.findOrder(execution.order_id);
    order.status = "FILLED";
    const position = this.updatePosition(execution);
    const record = { ...execution, position_id: position.id };
    this.executions.set(execution.id, record);
    return { ...record };
  }

  markToMarket(symbol: string, currentPrice: number): HarnessPosition {
    const position = this.findPosition(symbol);
    position.current_price = currentPrice;
    position.unrealized_pnl = (currentPrice - position.avg_price) * position.qty * (position.side === "LONG" ? 1 : -1);
    return { ...position };
  }

  metrics(): HarnessMetrics {
    const positions = [...this.positions.values()];
    const realized = positions.reduce((sum, position) => sum + position.realized_pnl, 0);
    const unrealized = positions.reduce((sum, position) => sum + position.unrealized_pnl, 0);
    return { account_id: this.account.id, realized_pnl: realized, unrealized_pnl: unrealized, ending_balance: this.account.balance + realized + unrealized, total_trades: this.executions.size, winning_trades: realized > 0 ? 1 : 0, losing_trades: realized < 0 ? 1 : 0 };
  }

  risk(): HarnessRisk {
    const metrics = this.metrics();
    const exposure = [...this.positions.values()].reduce((sum, position) => sum + position.qty * position.current_price, 0);
    return { account_id: this.account.id, status: metrics.realized_pnl + metrics.unrealized_pnl < 0 ? "WARNING" : "NORMAL", daily_loss: Math.min(0, metrics.realized_pnl + metrics.unrealized_pnl), exposure };
  }

  private updatePosition(execution: Omit<HarnessExecution, "position_id">): HarnessPosition {
    const current = [...this.positions.values()].find((position) => position.symbol === execution.symbol);
    const direction = execution.side === "BUY" ? 1 : -1;
    if (!current) {
      const position = { id: `position:${execution.account_id}:${execution.symbol}`, account_id: execution.account_id, symbol: execution.symbol, side: direction > 0 ? "LONG" as const : "SHORT" as const, qty: execution.qty, avg_price: execution.price, current_price: execution.price, realized_pnl: 0, unrealized_pnl: 0, is_open: true };
      this.positions.set(position.id, position);
      return position;
    }
    const sameSide = (current.side === "LONG" && direction > 0) || (current.side === "SHORT" && direction < 0);
    if (sameSide) {
      current.avg_price = ((current.avg_price * current.qty) + execution.price * execution.qty) / (current.qty + execution.qty);
      current.qty += execution.qty;
    } else {
      const closeQty = Math.min(current.qty, execution.qty);
      current.realized_pnl += (execution.price - current.avg_price) * closeQty * (current.side === "LONG" ? 1 : -1);
      current.qty -= closeQty;
      current.is_open = current.qty > 0;
      if (current.qty === 0) current.current_price = execution.price;
    }
    return current;
  }

  private findOrder(id: string): HarnessOrder { const order = [...this.orders.values()].find((item) => item.id === id); if (!order) throw new Error(`Unknown order: ${id}`); return order; }
  private findPosition(symbol: string): HarnessPosition { const position = [...this.positions.values()].find((item) => item.symbol === symbol); if (!position) throw new Error(`Unknown position: ${symbol}`); return position; }
}
