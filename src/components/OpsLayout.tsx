"use client"

import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { OpsSidebar } from "@/src/components/OpsSidebar";
import { Bell } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

export function OpsLayout({ children }: { children: React.ReactNode }) {
  const { data: unreadData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const res = await fetch('/api/notifications/unread-count')
      if (!res.ok) return { count: 0 }
      return res.json()
    },
    refetchInterval: 30000,
    staleTime: 25000,
  });

  const hasUnread = unreadData?.count ? unreadData.count > 0 : false;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <OpsSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-17 flex items-center justify-end border-b border-border bg-white px-4 sticky top-0 z-10">
            {/* <SidebarTrigger className="text-muted-foreground" /> */}
            <div className="flex items-center gap-2 mr-2">
              <Link href="/notifications">
                <Button variant="ghost" size="icon" className="relative h-10 w-10">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  {hasUnread && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
                  )}
                </Button>
              </Link>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 bg-white">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
