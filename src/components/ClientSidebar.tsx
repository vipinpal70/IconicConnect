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
import { useEffect, useState } from "react";

const navItems = [
  { title: "Dashboard", url: "/client/dashboard", icon: LayoutDashboard },
  { title: "Cases", url: "/client/cases", icon: FolderOpen },
  { title: "Notifications", url: "/notifications", icon: Bell },
  { title: "Analytics", url: "/client/analytics", icon: BarChart3 },
  { title: "Offers", url: "/client/offers", icon: Tag },
  { title: "Billing", url: "/client/billing", icon: CreditCard },
  { title: "Support", url: "/client/support", icon: HeadphonesIcon },
  { title: "Tutorials", url: "/client/tutorials", icon: PlayCircle },
  { title: "Profile", url: "/client/profile", icon: UserCircle },
];

type Profile = {
  full_name: string;
  lab_name: string;
}

async function getProfileData(): Promise<{ user: Profile | null; loading: boolean }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, loading: false };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return { user: profile, loading: false };
}

export function ClientSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { user, loading } = await getProfileData();
      setProfile(user);
      setLoading(loading);
    };
    fetchData();
  }, []);

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
              <p className="text-xs text-muted-foreground">Lab Portal</p>
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
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-[10px] font-bold">
            PD
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{profile?.lab_name}</p>
              <p className="text-xs text-muted-foreground">{profile?.full_name}</p>
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
