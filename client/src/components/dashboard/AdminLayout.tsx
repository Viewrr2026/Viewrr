import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import {
  LayoutDashboard,
  Store,
  FolderKanban,
  Users,
  BarChart3,
  HeadphonesIcon,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  X,
  BadgeCheck,
  Landmark,
  Crown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { isFounderPanelUser } from "@/lib/permissions";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/founder", icon: LayoutDashboard, exact: true },
  { label: "Accreditation", href: "/founder/accreditation", icon: BadgeCheck },
  { label: "Marketplace", href: "/founder/marketplace", icon: Store },
  { label: "Projects", href: "/founder/projects", icon: FolderKanban },
  { label: "Community", href: "/founder/community", icon: Users },
  { label: "Finance & Ops", href: "/founder/finance", icon: Landmark },
  { label: "Pro Subscriptions", href: "/founder/pro", icon: Crown },
  { label: "Insights", href: "/founder/insights", icon: BarChart3 },
  { label: "Support", href: "/founder/support", icon: HeadphonesIcon },
  { label: "Settings", href: "/founder/settings", icon: Settings },
];

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { user, logout } = useAuth();
  const [location, navigate] = useHashLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auth guard: client-side check
  useEffect(() => {
    if (!isFounderPanelUser(user)) {
      navigate("/");
    }
  }, [user]);

  // Session guard: verify the server-side session cookie is still valid.
  // After a deploy or cookie expiry, the vr_sess cookie may be gone even though
  // localStorage still shows the user as logged in. If the server returns 401,
  // clear the stale localStorage session so the user is prompted to re-login.
  useEffect(() => {
    if (!isFounderPanelUser(user)) return;
    fetch("/api/admin/dashboard", { method: "HEAD" })
      .then(res => {
        if (res.status === 401) {
          logout();
          navigate("/");
        }
      })
      .catch(() => { /* network error — let the page handle it */ });
  }, []);

  if (!isFounderPanelUser(user)) return null;

  function isActive(href: string, exact?: boolean) {
    if (exact) return location === href;
    return location.startsWith(href);
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo area */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-5 border-b border-zinc-200 dark:border-zinc-800",
        collapsed && "justify-center px-3"
      )}>
        <div className="w-8 h-8 rounded-lg bg-[#FF5A1F] flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">V</span>
        </div>
        {!collapsed && (
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-none">Viewrr</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Founder Panel</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className={cn("space-y-0.5", collapsed ? "px-2" : "px-3")}>
          {NAV_ITEMS.map(({ label, href, icon: Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <li key={href}>
                <Link href={href}>
                  <a
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group relative",
                      active
                        ? "bg-[#FF5A1F]/10 text-[#FF5A1F] dark:text-orange-400"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100",
                      collapsed && "justify-center px-2"
                    )}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? label : undefined}
                  >
                    <Icon
                      size={18}
                      strokeWidth={active ? 2 : 1.75}
                      className={cn(
                        "flex-shrink-0",
                        active ? "text-[#FF5A1F] dark:text-orange-400" : ""
                      )}
                    />
                    {!collapsed && <span>{label}</span>}
                    {/* Active dot */}
                    {active && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#FF5A1F] dark:bg-orange-400 flex-shrink-0" />
                    )}
                  </a>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className={cn("border-t border-zinc-200 dark:border-zinc-800 py-3", collapsed ? "px-2" : "px-3")}>
        {/* Back to platform */}
        <Link href="/">
          <a
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors",
              collapsed && "justify-center px-2"
            )}
            title={collapsed ? "Back to platform" : undefined}
          >
            <ChevronLeft size={14} className="flex-shrink-0" />
            {!collapsed && <span>Back to platform</span>}
          </a>
        </Link>
        {/* Logout */}
        <button
          onClick={() => { logout(); navigate("/"); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors",
            collapsed && "justify-center px-2"
          )}
          title={collapsed ? "Log out" : undefined}
        >
          <LogOut size={14} className="flex-shrink-0" />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-shrink-0 transition-all duration-200",
          collapsed ? "w-[60px]" : "w-[220px]"
        )}
      >
        <SidebarContent />
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute left-0 bottom-24 translate-x-[calc(var(--sidebar-w,220px)-12px)] hidden md:flex w-6 h-6 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 shadow-sm transition-colors z-10"
          style={{ "--sidebar-w": collapsed ? "60px" : "220px" } as React.CSSProperties}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 h-14 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3 px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
        >
          <Menu size={20} />
        </button>
        <div className="w-6 h-6 rounded-md bg-[#FF5A1F] flex items-center justify-center">
          <span className="text-white font-bold text-xs">V</span>
        </div>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Founder Panel</span>
      </div>

      {/* Mobile sidebar drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-[220px] bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-[#FF5A1F] flex items-center justify-center">
                  <span className="text-white font-bold text-xs">V</span>
                </div>
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Founder Panel</span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              >
                <X size={16} />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto md:pt-0 pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
