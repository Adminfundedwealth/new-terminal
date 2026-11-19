import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function BrokenPage() {
  throw new Error("module failed to render");
}

function RecoverablePage() {
  const [attempt, setAttempt] = useState(0);

  return (
    <ErrorBoundary key={attempt} onRecover={() => setAttempt((current) => current + 1)}>
      {attempt === 0 ? <BrokenPage /> : <p>Page recovered</p>}
    </ErrorBoundary>
  );
}

describe("ErrorBoundary recovery", () => {
  it("retries by remounting the failed route boundary", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(<RecoverablePage />);
      expect(screen.getByText("module failed to render")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /recover module/i }));

      expect(screen.getByText("Page recovered")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
