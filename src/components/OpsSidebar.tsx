"use client"

import {
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  ShieldCheck,
  Layers,
  LogOut,
  Bell,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { useQuery } from "@tanstack/react-query";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "All Cases", url: "/cases", icon: FolderOpen },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Notifications", url: "/notifications", icon: Bell },
];

export function OpsSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();
  const router = useRouter();

  // Fetch current user details dynamically
  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const res = await fetch('/api/profile')
      if (!res.ok) return null
      return res.json()
    }
  });

  const initials = profile?.fullName
    ? profile.fullName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'OP';

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    document.cookie.split(";").forEach((c) => {
      document.cookie = c
        .replace(/^ +/, "")
        .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = "/auth/sign-in";
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-glow">
            <span className="text-sm font-bold text-white">IC</span>
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-semibold text-foreground">Iconic Connect</h1>
              <p className="text-xs text-muted-foreground">Ops Portal</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link
                      href={item.url}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                        pathname === item.url && "bg-accent text-accent-foreground font-medium"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
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
          <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-bold">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{profile?.fullName || "Ops User"}</p>
              <p className="text-xs text-muted-foreground capitalize">{profile?.role?.replace('_', ' ') || "Internal Member"}</p>
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
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="text-xs font-medium">Log Out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
