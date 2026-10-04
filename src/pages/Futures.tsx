import { useMemo, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { classifyInstrument } from "@/lib/instrumentClassification";

export default function Futures() {
  const { instruments, isLoaded } = useInstrumentLookup();
  const [search, setSearch] = useState("");

  const futures = useMemo(() => {
    const query = search.trim().toUpperCase();
    return instruments
      .filter((instrument) => classifyInstrument(instrument) === "futures")
      .filter((instrument) => !query || instrument.symbol.toUpperCase().includes(query) || instrument.tradingSymbol.toUpperCase().includes(query))
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.expiryDate || "").localeCompare(b.expiryDate || ""));
  }, [instruments, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Futures</h1>
          <p className="text-sm text-muted-foreground">Stock futures and index futures from the instrument master</p>
        </div>
        <Badge variant="outline">{futures.length} contracts</Badge>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">Futures Contracts</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search futures..." className="h-8 pl-8 text-xs" />
          </div>
        </CardHeader>
        <CardContent>
          {!isLoaded ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Loading instrument master...</div>
          ) : futures.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No futures contracts found in the instrument master.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-2">Symbol</th><th className="pb-2">Trading Symbol</th><th className="pb-2">Type</th><th className="pb-2">Expiry</th><th className="pb-2 text-right">Lot Size</th><th className="pb-2">Security ID</th></tr></thead>
                <tbody>
                  {futures.map((instrument) => (
                    <tr key={instrument.securityId} className="border-b border-border/50 last:border-0">
                      <td className="py-2 font-semibold">{instrument.symbol}</td>
                      <td className="py-2 font-mono text-xs">{instrument.tradingSymbol}</td>
                      <td className="py-2"><Badge variant="outline" className="text-[10px]">{instrument.instrumentType}</Badge></td>
                      <td className="py-2 text-muted-foreground">{instrument.expiryDate || "-"}</td>
                      <td className="py-2 text-right font-mono">{instrument.lotSize}</td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">{instrument.securityId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
