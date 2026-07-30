"use client"

import {
  LayoutDashboard,
  ClipboardList,
  Headset,
  LogOut,
  Factory,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/src/lib/supabase/client";
import { Button } from "@/src/components/ui/button";
import { toast } from "sonner";
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
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface MillingMe {
  fullName: string | null;
  email: string;
  role: string;
  center: { name: string } | null;
}

const NAV_ITEMS = [
  { title: "Dashboard", url: "/milling/dashboard", icon: LayoutDashboard },
  { title: "Assigned Cases", url: "/milling/cases", icon: ClipboardList },
  { title: "Support", url: "/milling/support", icon: Headset },
]

export function MillingSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  const { data: me } = useQuery<MillingMe>({
    queryKey: ["milling-me"],
    queryFn: async () => {
      const res = await fetch("/api/milling/me");
      if (!res.ok) throw new Error("Failed to load profile");
      const json = await res.json();
      return json.data;
    },
  });

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    const toastId = toast.loading("Logging out...")
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Logout error:", err)
    } finally {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });

      localStorage.clear();
      sessionStorage.clear();
      toast.dismiss(toastId)
      window.location.href = "/auth/sign-in";
    }
  };

  return (
    <Sidebar collapsible="icon" className="bg-white lg:bg-transparent">
      <SidebarHeader className="p-4 border-b border-border bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center shadow-glow shrink-0">
              <Factory className="h-4 w-4 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground truncate">{me?.center?.name ?? "Milling Portal"}</h1>
                <p className="text-xs text-muted-foreground">Iconic Connect Partner</p>
              </div>
            )}
          </div>
          <SidebarTrigger className="hidden text-muted-foreground shrink-0 md:inline-flex" />
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3 bg-white">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link
                      href={item.url}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                        (pathname === item.url || pathname.startsWith(item.url + "/")) && "bg-accent text-accent-foreground font-medium"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="text-xs">{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="flex justify-between gap-2 item-center p-4 border-t border-border space-y-3 bg-white">
        <div className="flex items-center gap-4 mb-0">
          <div className="flex items-center gap-3 min-w-0">
            {!collapsed && (
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-xs font-semibold">
                {(me?.fullName || me?.email || "?").charAt(0).toUpperCase()}
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{me?.fullName || me?.email || "—"}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{me?.role.replace(/_/g, " ") ?? ""}</p>
              </div>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "justify-end text-red-500 hover:text-red-600 gap-2",
            collapsed && "justify-start px-0"
          )}
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <span className="text-[10px] font-medium animate-pulse">Logging out...</span>
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
