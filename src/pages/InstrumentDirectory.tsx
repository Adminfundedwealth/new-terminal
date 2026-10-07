import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useInstrumentLookup } from "@/hooks/useLocalDatabase";
import { fetchCashQuotes } from "@/lib/marketApi";
import { classifyInstrument, isProductionInstrument } from "@/lib/instrumentClassification";

const PAGE_SIZE = 50;

export default function InstrumentDirectory({ category }: { category: "stocks" | "indices" }) {
  const { instruments, isLoaded } = useInstrumentLookup();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const label = category === "stocks" ? "Stocks" : "Indices";
  const filteredRows = useMemo(() => {
    const query = search.trim().toUpperCase();
    return instruments
      .filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === category)
      .filter((instrument) => !query || instrument.symbol.toUpperCase().includes(query) || instrument.tradingSymbol.toUpperCase().includes(query))
      .sort((a, b) => a.tradingSymbol.localeCompare(b.tradingSymbol));
  }, [category, instruments, search]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const quoteGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const instrument of pageRows) {
      const ids = groups.get(instrument.exchangeSegment) || [];
      ids.push(instrument.securityId);
      groups.set(instrument.exchangeSegment, ids);
    }
    return [...groups.entries()];
  }, [pageRows]);
  const quoteQuery = useQuery({
    queryKey: ["cash-quotes", quoteGroups],
    queryFn: async () => {
      const responses = await Promise.all(quoteGroups.map(([segment, ids]) => fetchCashQuotes(segment, ids)));
      return Object.assign({}, ...responses);
    },
    enabled: isLoaded && quoteGroups.length > 0,
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 1,
  });

  const pageStart = filteredRows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, filteredRows.length);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{label}</h1>
          <p className="text-sm text-muted-foreground">
            {category === "stocks" ? "Cash-equity instruments" : "Cash index instruments"} with Dhan last traded prices
          </p>
        </div>
        <Badge variant="outline">{filteredRows.length} instruments</Badge>
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">{label} Instruments</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => void quoteQuery.refetch()}
              disabled={quoteQuery.isFetching || pageRows.length === 0}
              aria-label="Refresh prices"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${quoteQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!isLoaded ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading instrument master...
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No {label.toLowerCase()} instruments found in the instrument master.
            </p>
          ) : (
            <>
              {quoteQuery.error && (
                <p className="mb-3 text-sm text-destructive" role="alert">
                  Live prices could not be loaded: {quoteQuery.error.message}
                </p>
              )}
              <p className="mb-3 text-xs text-muted-foreground">
                Prices are fetched from Dhan for the visible page; derivatives are listed separately.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="pb-2">Instrument</th>
                      <th className="pb-2">Trading Symbol</th>
                      <th className="pb-2 text-right">Last Price</th>
                      <th className="pb-2">Segment</th>
                      <th className="pb-2">Security ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((instrument) => {
                      const price = quoteQuery.data?.[instrument.securityId]?.ltp;
                      return (
                        <tr key={instrument.securityId} className="border-b border-border/50 last:border-0">
                          <td className="py-2 font-semibold">{instrument.symbol}</td>
                          <td className="py-2 font-mono text-xs">{instrument.tradingSymbol}</td>
                          <td className="py-2 text-right font-mono">
                            {price === undefined ? "—" : `₹${price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </td>
                          <td className="py-2"><Badge variant="outline" className="text-[10px]">{instrument.exchangeSegment}</Badge></td>
                          <td className="py-2 font-mono text-xs text-muted-foreground">{instrument.securityId}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>Showing {pageStart}–{pageEnd} of {filteredRows.length}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
                    Previous
                  </Button>
                  <span>Page {page + 1} of {pageCount}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page + 1 >= pageCount}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
