"use client"

import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { ClientSidebar } from "@/src/components/ClientSidebar";
import { Bell } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const { data: unreadData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const res = await fetch('/api/notifications/unread-count')
      if (!res.ok) return { count: 0 }
      return res.json()
    },
    refetchInterval: 30000,
  });

  const hasUnread = unreadData?.count ? unreadData.count > 0 : false;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <ClientSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center justify-end border-b border-border bg-gray-50 px-4 sticky top-0 z-10">
            {/* <SidebarTrigger className="text-muted-foreground" /> */}
            <div className="flex items-center gap-2">
              <Link href="/notifications">
                <Button variant="ghost" size="icon" className="relative h-8 w-8">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  {hasUnread && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                  )}
                </Button>
              </Link>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-4 bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
