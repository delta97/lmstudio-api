import { NavLink, Outlet } from "react-router-dom";
import {
  HistoryIcon,
  LayersIcon,
  RadioIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only mark active on an exact match (used for the index route). */
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "New comparison", icon: SlidersHorizontalIcon, end: true },
  { to: "/run", label: "Live run", icon: RadioIcon },
  { to: "/results", label: "Results", icon: LayersIcon },
  { to: "/history", label: "History", icon: HistoryIcon },
];

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          "flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
          isActive && "bg-muted text-foreground",
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

/**
 * Application shell: navigation + routed content area. The nav is a left
 * sidebar on large screens and a horizontal top bar on small ones. The dark
 * technical theme is applied app-wide via the `dark` class on <html>.
 */
export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-border bg-sidebar p-4 lg:w-60 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-2 lg:flex-col lg:items-start lg:gap-1 lg:pt-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              visual regression
            </span>
            <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">
              Diff Inspector
            </span>
          </div>
        </div>

        <Separator className="hidden lg:block" />

        <nav className="-mx-1 flex flex-row gap-1 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>

        <div className="mt-auto hidden px-2 lg:block">
          <p className="font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
            api → localhost:3100
          </p>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
