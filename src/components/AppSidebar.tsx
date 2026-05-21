"use client"

import {
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  Tag,
  CreditCard,
  HeadphonesIcon,
  PlayCircle,
  UserCircle,
  LogOut,
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
  SidebarTrigger,
  useSidebar,
} from "@/src/components/ui/sidebar";
import { cn } from "@/src/lib/utils";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Cases", url: "/cases", icon: FolderOpen },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Offers", url: "/offers", icon: Tag },
  { title: "Billing", url: "/billing", icon: CreditCard },
  { title: "Support", url: "/support", icon: HeadphonesIcon },
  { title: "Tutorials", url: "/tutorials", icon: PlayCircle },
  { title: "Profile", url: "/profile", icon: UserCircle },
];


export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();

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
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center shadow-glow">
              <span className="text-sm font-bold text-primary-foreground">IC</span>
            </div>
            {!collapsed && (
              <div>
                <h1 className="text-sm font-semibold text-foreground">Iconic Connect</h1>
                <p className="text-xs text-muted-foreground">Lab Portal</p>
              </div>
            )}
          </div>
          <SidebarTrigger className="hidden text-muted-foreground shrink-0 md:inline-flex" />
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isClientPath = pathname.startsWith("/client");
                const itemUrl = isClientPath ? `/client${item.url === "/dashboard" ? "/dashboard" : item.url}` : item.url;
                const isActive = pathname === itemUrl;

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <Link
                        href={itemUrl}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                          isActive && "bg-accent text-accent-foreground font-medium"
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="text-sm">{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-border space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-[10px] font-bold">
            PD
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate"></p>
              <p className="text-xs text-muted-foreground">Daniel Ortega</p>
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
