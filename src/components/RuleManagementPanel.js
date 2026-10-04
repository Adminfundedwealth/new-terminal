import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    const productIds = useMemo(() => (plansQuery.data?.data ?? []).map((plan) => plan.id), [plansQuery.data]);
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
            if (!plan)
                continue;
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
    return (_jsxs("section", { className: "rounded-lg border border-border/70 bg-card p-4", children: [_jsxs("div", { className: "mb-4 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold", children: "Canonical plan rule management" }), _jsx("p", { className: "text-xs text-muted-foreground", children: "Live rule versions in the new canonical Supabase." })] }), _jsx("button", { className: "rounded border border-border px-2 py-1 text-xs", onClick: () => void createSeed(), children: "Seed canonical rules" })] }), _jsx("div", { className: "space-y-3", children: (plansQuery.data?.data ?? []).map((plan) => {
                    const matchingVersions = (versionsQuery.data ?? []).filter((version) => version.product_id === plan.id);
                    return (_jsxs("div", { className: "rounded border border-border/70 p-3", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-wide text-muted-foreground", children: plan.code }), _jsx("h3", { className: "text-sm font-semibold", children: plan.name })] }), _jsxs("span", { className: "rounded bg-primary/10 px-2 py-1 text-[10px] font-medium", children: [matchingVersions.length, " versions"] })] }), _jsx("div", { className: "space-y-2 text-xs text-muted-foreground", children: matchingVersions.length === 0 ? (_jsx("p", { children: "No rule versions yet." })) : (matchingVersions.map((version) => (_jsxs("div", { className: "rounded border border-border/60 bg-muted/30 p-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-semibold text-foreground", children: version.version }), _jsx("span", { className: "uppercase", children: version.status })] }), _jsx("pre", { className: "mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground", children: JSON.stringify(version.rules, null, 2) })] }, version.id)))) })] }, plan.id));
                }) })] }));
}
