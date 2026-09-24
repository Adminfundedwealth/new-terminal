import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, IndianRupee, Newspaper, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchIndianMarketNews, type IndianNewsArticle } from "@/lib/marketApi";

const INDIAN_TERMS = /\b(india|indian|nse|bse|nifty|banknifty|finnifty|sensex|sebi|rbi|dalal|mumbai|rupee|inr|f&o|fno|listed|ipo|stock market|shares?|equities?|earnings?|quarterly results?|dividend|buyback)\b/i;
const EXCLUDED_TERMS = /\b(crypto(?:currency)?|bitcoin|ethereum|nasdaq|dow jones|s&p 500|wall street|us stocks?|american stocks?|european stocks?|forex|oil prices?|gold prices?|global markets?|federal reserve|fed rate)\b/i;

function isIndianMarketArticle(article: IndianNewsArticle): boolean {
  const text = `${article.headline} ${article.summary}`;
  return INDIAN_TERMS.test(text) && !EXCLUDED_TERMS.test(text);
}

function relativeTime(value: string | null): string {
  if (!value) return "Time unavailable";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function stripSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export default function MarketNews() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["indian-market-news"],
    queryFn: fetchIndianMarketNews,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const articles = useMemo(() => (data?.articles || []).filter(isIndianMarketArticle), [data]);

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 p-3 sm:p-5">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Newspaper className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">India Markets</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">Market News</h2>
          <p className="mt-1 text-sm text-muted-foreground">Live NSE, BSE, NIFTY, Indian F&O, SEBI, RBI and listed-company coverage.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </section>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="gap-1 border-primary/25 text-primary"><IndianRupee className="h-3 w-3" /> India only</Badge>
        {data?.provider && <span>Sources: {data.provider}</span>}
        {data?.fetchedAt && <span>Updated {relativeTime(data.fetchedAt)}</span>}
      </div>

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-48" />)}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-dashed border-border/80 bg-card/30 px-4 py-10 text-center">
          <Newspaper className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-semibold">Indian market news is unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">No article content is shown until the server-side provider responds.</p>
        </div>
      )}

      {!isLoading && !isError && articles.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/80 bg-card/30 px-4 py-10 text-center">
          <Newspaper className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-semibold">No Indian market news available</p>
          <p className="mt-1 text-xs text-muted-foreground">Only real provider articles matching Indian market coverage are displayed.</p>
        </div>
      )}

      {articles.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {articles.map((article) => (
            <Card key={`${article.source}-${article.url}`} className="group overflow-hidden border-border/70 bg-card/80 transition-colors hover:border-primary/35">
              {article.image && <img src={article.image} alt="" className="h-36 w-full object-cover opacity-90" loading="lazy" />}
              <CardHeader className="space-y-2 pb-2">
                <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>{article.source}</span>
                  <span>{relativeTime(article.publishedAt)}</span>
                </div>
                <CardTitle className="text-base leading-snug group-hover:text-primary">{article.headline}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {article.summary && <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{stripSummary(article.summary)}</p>}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">{article.category}</Badge>
                    {article.related && <Badge variant="outline" className="text-[10px]">{article.related}</Badge>}
                  </div>
                  <a href={article.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Read <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
