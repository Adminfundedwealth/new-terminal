import { BarChart3, Briefcase, CalendarDays, CandlestickChart, LayoutDashboard, Layers, Moon, Newspaper, Settings, Star, Sun, TableProperties, TrendingUp } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarSeparator,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, shortcut: "1" },
  { title: "Stocks", url: "/stocks", icon: TrendingUp, shortcut: "2" },
  { title: "Indices", url: "/indices", icon: TableProperties, shortcut: "3" },
  { title: "Option Chain", url: "/option-chain", icon: CandlestickChart, shortcut: "4" },
  { title: "Futures", url: "/futures", icon: CandlestickChart, shortcut: "5" },
  { title: "OI Analysis", url: "/oi-analysis", icon: BarChart3, shortcut: "6" },
  { title: "Watchlist", url: "/watchlist", icon: Star, shortcut: "7" },
];

const tradingItems = [
  { title: "Strategy Builder", url: "/strategy-builder", icon: Layers, shortcut: "8" },
  { title: "Position Tracker", url: "/position-tracker", icon: Briefcase, shortcut: "9" },
  { title: "Calendar", url: "/calendar", icon: CalendarDays, shortcut: "10" },
  { title: "Market News", url: "/market-news", icon: Newspaper, shortcut: "11" },
];

const settingItems = [
  { title: "Broker API Keys", url: "/broker-settings", icon: Settings },
  { title: "My Stats", url: "/my-stats", icon: BarChart3 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isDark, toggle: toggleTheme } = useTheme();

  const renderNavItems = (items: { title: string; url: string; icon: typeof LayoutDashboard; shortcut?: string }[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild tooltip={collapsed ? item.title : undefined} className={collapsed ? "!size-10 !p-0 rounded-xl" : undefined}>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            title={collapsed ? item.title : undefined}
            className={cn(
              "group relative flex items-center gap-2.5 text-sm font-medium transition-all duration-200",
              collapsed
                ? "!size-10 justify-center rounded-xl p-0 text-white/70 hover:bg-white/10 hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                : "h-9 rounded-lg px-2.5 text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
            )}
            activeClassName={cn(
              "font-semibold",
              collapsed
                ? "bg-primary text-primary-foreground shadow-[0_16px_28px_-18px_hsl(var(--primary)/0.95),inset_0_1px_0_hsl(0_0%_100%/0.22)] before:absolute before:left-[-10px] before:top-1/2 before:h-8 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-primary"
                : "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)] before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary",
            )}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
            {!collapsed && (
              <>
                <span className="flex-1">{item.title}</span>
                {"shortcut" in item && item.shortcut && (
                  <kbd className="text-2xs font-mono text-muted-foreground/40 group-hover:text-muted-foreground/60 bg-transparent border-0 px-0">⌘{item.shortcut}</kbd>
                )}
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={cn("border-b border-sidebar-border/80 px-3 py-3", collapsed && "items-center border-white/10 px-0 py-3")}>
        <div className={cn("flex items-center gap-3", collapsed && "justify-center gap-0")}>
          <img src="/brand-logo-original.png" alt="FundedWealth" className={cn("object-contain", collapsed ? "h-11 w-11" : "h-11 w-11")} />
          {!collapsed && (
            <div className="flex flex-col items-start leading-[0.7]">
              <h1 className="text-[14px] font-black tracking-[0.1em] text-white uppercase">FUNDEDWEALTH</h1>
              <p className="mt-1 w-full text-center text-[16px] font-bold tracking-[0.2em] text-white/80 uppercase">TERMINAL</p>
            </div>
          )}
        </div>
        {collapsed && (
          <div className="mt-1 text-center leading-[0.7]">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white">FW</p>
            <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.18em] text-white/75">TERM</p>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={cn("px-2 py-2.5", collapsed && "px-0 py-3")}>
        {collapsed ? (
          <div className="flex h-full flex-col items-center">
            <SidebarMenu className="items-center gap-2">{renderNavItems(mainItems)}</SidebarMenu>
            <div className="my-3 h-px w-8 bg-white/10" />
            <SidebarMenu className="items-center gap-2">{renderNavItems(tradingItems)}</SidebarMenu>
            <div className="my-3 h-px w-8 bg-white/10" />
            <SidebarMenu className="items-center gap-2">{renderNavItems(settingItems)}</SidebarMenu>
          </div>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupLabel className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">Markets</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-0.5">{renderNavItems(mainItems)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarSeparator className="my-2 opacity-35" />

            <SidebarGroup>
              <SidebarGroupLabel className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">Trading Tools</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-0.5">{renderNavItems(tradingItems)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarSeparator className="my-2 opacity-35" />

            <SidebarGroup>
              <SidebarGroupLabel className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">Settings</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-0.5">{renderNavItems(settingItems)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className={cn("space-y-1 border-t border-sidebar-border/80 p-2", collapsed && "items-center border-white/10 p-0 py-3")}>
        <button
          onClick={toggleTheme}
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground/85 transition-all duration-200 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
            collapsed && "h-10 w-10 justify-center rounded-xl px-0 py-0 text-white/65 hover:bg-white/10 hover:text-white",
          )}
          title={collapsed ? (isDark ? "Light Mode" : "Dark Mode") : undefined}
        >
          {isDark ? <Sun className="h-[18px] w-[18px] group-hover:text-warning transition-colors" strokeWidth={1.75} /> : <Moon className="h-[18px] w-[18px] group-hover:text-primary transition-colors" strokeWidth={1.75} />}
          {!collapsed && <span>{isDark ? "Light Mode" : "Dark Mode"}</span>}
        </button>
        {collapsed && <span className="font-mono text-[8px] font-semibold text-white/28">v1</span>}
        {!collapsed && (
          <div className="mx-1 mt-2 flex items-center justify-between rounded-md border border-primary/15 bg-primary/5 px-3 py-2">
             <span className="text-xs font-bold text-primary tracking-wider">PRO</span>
             <span className="text-[10px] text-primary/65 uppercase tracking-widest font-mono">v1.0.0</span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
