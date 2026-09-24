import { useMemo, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { classifyInstrument, type InstrumentCategory } from "@/lib/instrumentClassification";

export default function InstrumentDirectory({ category }: { category: "stocks" | "indices" }) {
  const { instruments, isLoaded } = useInstrumentLookup();
  const [search, setSearch] = useState("");
  const label = category === "stocks" ? "Stocks" : "Indices";
  const rows = useMemo(() => {
    const query = search.trim().toUpperCase();
    return instruments
      .filter((instrument) => classifyInstrument(instrument) === (category as InstrumentCategory))
      .filter((instrument) => !query || instrument.symbol.toUpperCase().includes(query) || instrument.tradingSymbol.toUpperCase().includes(query))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [category, instruments, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">{label}</h1><p className="text-sm text-muted-foreground">{label} instruments from the instrument master</p></div>
        <Badge variant="outline">{rows.length} instruments</Badge>
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-sm">{label} Instruments</CardTitle><div className="relative w-64"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}...`} className="h-8 pl-8 text-xs" /></div></CardHeader>
        <CardContent>
          {!isLoaded ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Loading instrument master...</div> : rows.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No {label.toLowerCase()} instruments found in the instrument master.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-2">Symbol</th><th className="pb-2">Trading Symbol</th><th className="pb-2">Segment</th><th className="pb-2 text-right">Lot Size</th><th className="pb-2">Security ID</th></tr></thead><tbody>{rows.map((instrument) => <tr key={instrument.securityId} className="border-b border-border/50 last:border-0"><td className="py-2 font-semibold">{instrument.symbol}</td><td className="py-2 font-mono text-xs">{instrument.tradingSymbol}</td><td className="py-2"><Badge variant="outline" className="text-[10px]">{instrument.exchangeSegment}</Badge></td><td className="py-2 text-right font-mono">{instrument.lotSize}</td><td className="py-2 font-mono text-xs text-muted-foreground">{instrument.securityId}</td></tr>)}</tbody></table></div>}
        </CardContent>
      </Card>
    </div>
  );
}
