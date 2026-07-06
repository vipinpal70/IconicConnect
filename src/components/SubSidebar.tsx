"use client"

import {
  LayoutDashboard,
  FolderOpen,
  UserCircle,
  LogOut,
  Bell,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/src/lib/supabase/client";
import { Button } from "@/src/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/src/components/ui/sidebar";
import { cn } from "@/src/lib/utils";
import { useEffect, useState } from "react";
import { useSidebarBadges } from "@/src/hooks/useSidebarBadges"
import { toast } from "sonner";

const NAV_ITEMS = [
  { title: "Dashboard",     url: "/dashboard",     icon: LayoutDashboard },
  { title: "Cases",         url: "/cases",         icon: FolderOpen,  badgeKey: "cases" },
  { title: "Notifications", url: "/notifications", icon: Bell,        badgeKey: "notifications" },
  { title: "Profile",       url: "/profile",       icon: UserCircle },
]

export function SubSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const { badges, markSeen } = useSidebarBadges()

  // Mark the current page as seen whenever the route changes
  useEffect(() => {
    const item = NAV_ITEMS.find(
      (i) => i.url === pathname || pathname.startsWith(i.url + '/')
    )
    if (item?.badgeKey) {
      markSeen(item.badgeKey)
    }
  }, [pathname, markSeen])

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    const toastId = toast.loading("Logging out...");
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });

      localStorage.clear();
      sessionStorage.clear();
      toast.dismiss(toastId);
      window.location.href = "/auth/sign-in";
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-600 flex items-center justify-center shadow-glow">
            <span className="text-sm font-bold text-white">IC</span>
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-semibold text-foreground">Iconic Connect</h1>
              <p className="text-xs text-muted-foreground">Team Member</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link
                      href={item.url}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                        pathname === item.url && "bg-accent text-accent-foreground font-medium"
                      )}
                    >
                      <span className="relative shrink-0">
                        <item.icon className="h-4 w-4" />
                        {item.badgeKey && badges[item.badgeKey] && (
                          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500 ring-1 ring-white" />
                        )}
                      </span>
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-border space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-[10px] font-bold">
            TM
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">Team Member</p>
              <p className="text-xs text-muted-foreground">Lab Staff</p>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 gap-2",
            collapsed && "justify-center px-0"
          )}
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <span className="text-xs font-medium animate-pulse ml-6">Logging out...</span>
          ) : (
            <>
              <LogOut className="h-4 w-4" />
              {!collapsed && <span className="text-xs font-medium">Log Out</span>}
            </>
          )}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
