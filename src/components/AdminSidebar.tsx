"use client"

import {
  LayoutDashboard,
  ClipboardList,
  PlayCircle,
  Tag,
  Building2,
  LogOut,
  Users,
  Bell,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/src/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
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

export function AdminSidebar() {
  const navItems = [
    { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
    { title: "Cases", url: "/admin/cases", icon: ClipboardList },
    { title: "Tutorials", url: "/admin/tutorials", icon: PlayCircle },
    { title: "Offers", url: "/admin/offers", icon: Tag },
    { title: "Clients", url: "/admin/clients", icon: Building2 },
    { title: "Team", url: "/admin/team", icon: Users },
    { title: "Notifications", url: "/admin/notifications", icon: Bell },
  ];

  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();

  const { data: currentUser } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/admin/me')
      if (!res.ok) return null
      return res.json()
    }
  })

  const isNotAdmin = currentUser && currentUser.role !== 'admin';

  const filteredNavItems = navItems.filter(item => {
    if (item.title === "Team" && isNotAdmin) return false;
    return true;
  });

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();

    // Clear all cookies
    document.cookie.split(";").forEach((c) => {
      document.cookie = c
        .replace(/^ +/, "")
        .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });

    // Clear storage
    localStorage.clear();
    sessionStorage.clear();

    // Hard redirect to clear any remaining in-memory state
    window.location.href = "/auth/sign-in";
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center shadow-glow">
            <span className="text-sm font-bold text-primary-foreground">IC</span>
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-semibold text-foreground">Iconic Connect</h1>
              <p className="text-xs text-muted-foreground">Admin Portal</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredNavItems.map((item) => (
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
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-[10px] font-bold">
            SA
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">Iconic Dental</p>
              <p className="text-xs text-muted-foreground">Super Admin</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "justify-end text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 gap-3",
              collapsed && "justify-center px-0 "
            )}
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
