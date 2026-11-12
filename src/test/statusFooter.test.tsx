import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusFooter } from "@/components/StatusFooter";

describe("StatusFooter", () => {
  it("does not show an unverified Terminal OS health status on a customer page", () => {
    render(<StatusFooter />);

    expect(screen.queryByText("Terminal OS")).not.toBeInTheDocument();
    expect(screen.queryByText("UNKNOWN")).not.toBeInTheDocument();
  });
});
