"use client"

import {
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  Tag,
  CreditCard,
  PlayCircle,
  UserCircle,
  FileText,
  LogOut,
  Bell,
  Headset,
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
import { useEffect, useState } from "react";
import logo from "@/public/IconicConnectLogo.png"
import Image from "next/image"
import { useSidebarBadges } from "@/src/hooks/useSidebarBadges"

const NAV_ITEMS = [
  { title: "Dashboard",        url: "/client/dashboard",   icon: LayoutDashboard },
  { title: "Cases",            url: "/client/cases",       icon: FolderOpen,  badgeKey: "cases" },
  { title: "Analytics",        url: "/client/analytics",   icon: BarChart3 },
  { title: "Tutorials",        url: "/client/tutorials",   icon: PlayCircle,  badgeKey: "tutorials" },
  { title: "Offers",           url: "/client/offers",      icon: Tag,         badgeKey: "offers" },
  { title: "Support",          url: "/client/support",     icon: Headset,     badgeKey: "support" },
  { title: "Billing",          url: "/client/billing",     icon: CreditCard,  badgeKey: "billing" },
  { title: "Notifications",    url: "/notifications",      icon: Bell,        badgeKey: "notifications" },
  { title: "Preference Forms", url: "/client/preferences", icon: FileText },
  { title: "Profile",          url: "/client/profile",     icon: UserCircle },
]

type Profile = {
  full_name: string;
  lab_name: string;
  user_role: string;
}

async function getProfileData(): Promise<Profile | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return profile;
}

export function ClientSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const { badges, markSeen } = useSidebarBadges()

  useEffect(() => {
    const fetchData = async () => {
      const user = await getProfileData();
      setProfile(user);
    };
    fetchData();
  }, []);

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
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {!collapsed && (
              <div>
                <Image src={logo} alt="Iconic Connect" width={100} height={100} />
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
              {NAV_ITEMS
                .filter((item) => {
                  if (profile?.user_role === "subuser") {
                    return item.title !== "Billing" && item.title !== "Analytics";
                  }
                  return true;
                })
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <Link
                        href={item.url}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                          pathname === item.url && "bg-accent text-accent-foreground font-medium"
                        )}
                      >
                        <span className="relative shrink-0">
                          <item.icon className="h-4 w-4" />
                          {item.badgeKey && badges[item.badgeKey] && (
                            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500 ring-1 ring-white" />
                          )}
                        </span>
                        {!collapsed && <span className="text-xs">{item.title}</span>}
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
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-xs font-semibold">
              {profile?.lab_name?.charAt(0)}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{profile?.lab_name}</p>
                <p className="text-xs text-muted-foreground">{profile?.full_name}</p>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "justify-end text-red-500 hover:text-red-600 hover:bg-red-50 gap-2",
              collapsed && "justify-end px-0"
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
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
