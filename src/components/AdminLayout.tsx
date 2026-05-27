"use client"

import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { AdminSidebar } from "@/src/components/AdminSidebar";
import { Bell } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

export function AdminLayout({ children }: { children: React.ReactNode }) {
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
        <AdminSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center justify-between border-b border-border bg-gray-50 px-4 sticky top-0 z-10">
            <SidebarTrigger className="text-muted-foreground lg:hidden h-9 w-9" />
            <div className="flex items-center gap-2 ml-auto">
              <Link href="/notifications">
                <Button variant="ghost" size="icon" className="relative h-9 w-9">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  {hasUnread && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
                  )}
                </Button>
              </Link>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 bg-gray-50">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}