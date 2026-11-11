import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OptionChainStrikeActions } from "@/components/OptionChainStrikeActions";

describe("OptionChainStrikeActions", () => {
  it("renders readable call and put controls with icons and routes each action to its option side", () => {
    const onChart = vi.fn();
    const onBuy = vi.fn();
    const onSell = vi.fn();
    const onToggleSelection = vi.fn();
    const onToggleWatchlist = vi.fn();
    const onFullscreen = vi.fn();
    const onAlert = vi.fn();
    const onForeverOrder = vi.fn();
    const resolveContract = vi.fn(() => null);

    render(
      <OptionChainStrikeActions
        strike={1340}
        onChart={onChart}
        onBuy={onBuy}
        onSell={onSell}
        isSelected={() => false}
        onToggleSelection={onToggleSelection}
        isInWatchlist={() => false}
        onToggleWatchlist={onToggleWatchlist}
        onFullscreen={onFullscreen}
        onAlert={onAlert}
        onForeverOrder={onForeverOrder}
        resolveContract={resolveContract}
      />,
    );

    const callActions = within(screen.getByRole("group", { name: "1340 CALL (CE) actions" }));
    const putActions = within(screen.getByRole("group", { name: "1340 PUT (PE) actions" }));

    expect(callActions.getByRole("button", { name: "Chart 1340 CE" })).toHaveTextContent("Chart");
    expect(callActions.getByRole("button", { name: "Buy 1340 CE" })).toHaveTextContent("Buy");
    expect(callActions.getByRole("button", { name: "Sell 1340 CE" })).toHaveTextContent("Sell");
    expect(putActions.getByRole("button", { name: "Chart 1340 PE" })).toHaveTextContent("Chart");
    expect(putActions.getByRole("button", { name: "Buy 1340 PE" })).toHaveTextContent("Buy");
    expect(putActions.getByRole("button", { name: "Sell 1340 PE" })).toHaveTextContent("Sell");
    expect(document.body.textContent).not.toMatch(/�|Ã.|Â.|ƒ|Æ|ð/);

    fireEvent.click(callActions.getByRole("button", { name: "Chart 1340 CE" }));
    fireEvent.click(callActions.getByRole("button", { name: "Buy 1340 CE" }));
    fireEvent.click(callActions.getByRole("button", { name: "Sell 1340 CE" }));
    fireEvent.click(putActions.getByRole("button", { name: "Chart 1340 PE" }));
    fireEvent.click(putActions.getByRole("button", { name: "Buy 1340 PE" }));
    fireEvent.click(putActions.getByRole("button", { name: "Sell 1340 PE" }));
    fireEvent.click(callActions.getByRole("button", { name: "Add 1340 CE to basket" }));
    fireEvent.click(putActions.getByRole("button", { name: "Add 1340 PE to watchlist" }));
    fireEvent.click(callActions.getByRole("button", { name: "Market depth 1340 CE" }));
    expect(screen.getByText(/Market-depth levels are unavailable from the connected Dhan market-data service/)).toBeInTheDocument();

    expect(onChart.mock.calls).toEqual([["CE"], ["PE"]]);
    expect(onBuy.mock.calls).toEqual([["CE"], ["PE"]]);
    expect(onSell.mock.calls).toEqual([["CE"], ["PE"]]);
    expect(onToggleSelection).toHaveBeenCalledWith("CE");
    expect(onToggleWatchlist).toHaveBeenCalledWith("PE");
  });
});
