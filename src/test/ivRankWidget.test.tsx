import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IVRankCard } from "@/components/IVRankWidget";

describe("IVRankCard", () => {
  it("does not display a fabricated rank when current volatility is unavailable", () => {
    render(<IVRankCard symbol="NIFTY" currentIV={0} />);

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("No current volatility quote or verified historical IV is available.")).toBeInTheDocument();
    expect(screen.queryByText(/NaN|%/)).not.toBeInTheDocument();
  });
});
