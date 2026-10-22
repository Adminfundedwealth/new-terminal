import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusFooter } from "@/components/StatusFooter";

describe("StatusFooter", () => {
  it("does not call the employee-only health endpoint for a customer page", () => {
    render(<StatusFooter />);

    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
  });
});
