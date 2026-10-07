"use client"

import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { ClientSidebar } from "@/src/components/ClientSidebar";
import { Bell } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import Link from "next/link";
import { useState } from "react";
import { useSidebarBadges } from "@/src/hooks/useSidebarBadges";
import { SequentialPrefetcher, type PrefetchTask } from "@/src/components/SequentialPrefetcher";

const getJson = async (url: string, signal: AbortSignal) => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(url)
  return res.json()
}

// Everything the landing page needs is already fetched by the page/layout itself (dashboard, profile,
// badges), so the only background warm-up kept is the page users open next: the cases list (server cache).
function clientPrefetchTasks(): PrefetchTask[] {
  return [
    { name: "cases", run: (_qc, signal) => getJson("/api/cases?limit=100&page=1", signal) },
  ]
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  // Shares the sidebar's single /api/sidebar-badges poll instead of running a second one.
  const { badges } = useSidebarBadges();
  const hasUnread = Boolean(badges.notifications);
  const prefetchTasks = useState(clientPrefetchTasks)[0];

  return (
    <SidebarProvider>
      <SequentialPrefetcher tasks={prefetchTasks} />
      <div className="min-h-screen flex w-full">
        <ClientSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center justify-end border-b border-border bg-gray-50 px-4 sticky top-0 z-10">
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
          <main className="flex-1 overflow-auto p-4 bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
