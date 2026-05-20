"use client"

import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { AppSidebar } from "@/src/components/AppSidebar";
import { Bell } from "lucide-react";
import { Button } from "@/src/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between bg-white border-b border-border px-4 sticky top-0 z-10">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
