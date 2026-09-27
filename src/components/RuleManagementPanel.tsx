import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchCanonicalPlans, fetchCanonicalRuleVersions, saveRuleConfiguration } from "@/lib/terminalApi";
import { FUNDEDWEALTH_PLAN_ORDER, getFundedWealthPlanRules } from "@/lib/fundedwealthPlanRules";

export function RuleManagementPanel() {
  const plansQuery = useQuery({
    queryKey: ["canonical-plans"],
    queryFn: fetchCanonicalPlans,
    retry: false,
  });

  const productIds = useMemo(
    () => (plansQuery.data?.data ?? []).map((plan) => plan.id),
    [plansQuery.data],
  );

  const versionsQuery = useQuery({
    queryKey: ["canonical-rule-versions", productIds],
    queryFn: async () => {
      const results = await Promise.all(productIds.map((productId) => fetchCanonicalRuleVersions(productId)));
      return results.flatMap((result) => result.data);
    },
    enabled: productIds.length > 0,
    retry: false,
  });

  const createSeed = async () => {
    for (const planCode of FUNDEDWEALTH_PLAN_ORDER) {
      const rules = getFundedWealthPlanRules(planCode);
      const plan = plansQuery.data?.data.find((item) => item.code === planCode);
      if (!plan) continue;
      await saveRuleConfiguration("create_rule_version", {
        product_id: plan.id,
        phase_id: null,
        version: "v1",
        rules,
      });
    }
    await plansQuery.refetch();
    await versionsQuery.refetch();
  };

  return (
    <section className="rounded-lg border border-border/70 bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Canonical plan rule management</h2>
          <p className="text-xs text-muted-foreground">Live rule versions in the new canonical Supabase.</p>
        </div>
        <button className="rounded border border-border px-2 py-1 text-xs" onClick={() => void createSeed()}>
          Seed canonical rules
        </button>
      </div>

      <div className="space-y-3">
        {(plansQuery.data?.data ?? []).map((plan) => {
          const matchingVersions = (versionsQuery.data ?? []).filter((version) => version.product_id === plan.id);
          return (
            <div key={plan.id} className="rounded border border-border/70 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{plan.code}</p>
                  <h3 className="text-sm font-semibold">{plan.name}</h3>
                </div>
                <span className="rounded bg-primary/10 px-2 py-1 text-[10px] font-medium">{matchingVersions.length} versions</span>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                {matchingVersions.length === 0 ? (
                  <p>No rule versions yet.</p>
                ) : (
                  matchingVersions.map((version) => (
                    <div key={version.id} className="rounded border border-border/60 bg-muted/30 p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">{version.version}</span>
                        <span className="uppercase">{version.status}</span>
                      </div>
                      <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                        {JSON.stringify(version.rules, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
