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
  Headset,
  CreditCard ,
  BarChart3
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
import { useEffect, useState } from "react";
import Image from "next/image"
import logo from "@/public/IconicConnectLogo.png"

export function AdminSidebar() {
  const navItems = [
    { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
    { title: "Cases", url: "/admin/cases", icon: ClipboardList },
    { title: "Analytics", url: "/admin/analytics", icon: BarChart3},
    { title: "Clients", url: "/admin/clients", icon: Building2 },
    { title: "Billing", url: "/admin/billing", icon: CreditCard },
    { title: "Team", url: "/admin/team", icon: Users },
    { title: "Tutorials", url: "/admin/tutorials", icon: PlayCircle },
    { title: "Offers", url: "/admin/offers", icon: Tag },
    { title: "Support", url: "/admin/support", icon: Headset },
    { title: "Notifications", url: "/admin/notifications", icon: Bell },
  ];

  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();
  const [profile, setProfile] = useState<{
    fullName: string | null
    role: string | null
    labName: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const fetchProfile = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user || !active) {
        setProfile(null)
        setLoading(false)
        return
      }

      const res = await fetch(`/api/profile/${user.id}`, {
        cache: "no-store",
      })
      if (!active) return

      if (!res.ok) {
        setProfile(null)
        setLoading(false)
        return
      }

      const data = await res.json().catch(() => null)
      if (!active) return

      setProfile(data)
      setLoading(false)
    }

    fetchProfile()

    return () => {
      active = false
    }
  }, [])

  const isNotAdmin = profile?.role !== "admin"

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
    <Sidebar collapsible="icon" className="bg-white lg:bg-transparent">
      <SidebarHeader className="p-4 border-b border-border bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Image src={logo} alt="Iconic Connect" width={100} height={100} />
          </div>
          <SidebarTrigger className="hidden text-muted-foreground shrink-0 md:inline-flex" />
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3 bg-white">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link
                      href={item.url}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                        pathname === item.url && "bg-accent text-accent-foreground font-medium"
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
                {(profile?.fullName)?.charAt(0).toUpperCase()}
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {loading ? "Loading..." : (profile?.fullName || "-")}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {loading ? "Loading role..." : (profile?.role || "-")}
                </p>
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
        >
          <LogOut className="h-4 w-4" />
          {/* {!collapsed && <span className="text-xs font-medium">Log Out</span>} */}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}