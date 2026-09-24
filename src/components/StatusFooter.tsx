import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchTerminalSystemHealth } from "@/lib/terminalApi";

export const StatusFooter = () => {
  const [time, setTime] = useState(new Date());
  const { data: terminalHealth, error: terminalHealthError } = useQuery({
    queryKey: ["terminal-os-system-health"],
    queryFn: fetchTerminalSystemHealth,
    retry: false,
    staleTime: 30_000,
  });
  const databaseCheck = terminalHealth?.data.find((check) => check.name === "database");

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 flex h-9 items-center justify-between gap-2 overflow-hidden border-t border-border/80 bg-background/95 px-3 text-[11px] font-mono text-muted-foreground backdrop-blur-md sm:px-4">
      <div className="flex shrink-0 items-center gap-2 sm:gap-6">
        <div className="hidden items-center gap-3 md:flex">
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">Ctrl K</kbd> Search
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">R</kbd> Refresh
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">1-6</kbd> Navigate
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:border-l sm:border-border sm:pl-4">
          <Clock size={12} />
          <span>{time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>

        <div className="hidden items-center gap-1.5 border-l border-border pl-4 sm:flex">
          <span>Terminal OS</span>
          <span className={databaseCheck ? "text-emerald-500" : "text-amber-500"}>
            {databaseCheck ? databaseCheck.status : terminalHealthError ? "UNAUTHORIZED / UNAVAILABLE" : "CHECKING"}
          </span>
        </div>

      </div>
    </footer>
  );
};
