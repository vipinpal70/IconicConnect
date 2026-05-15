"use client"

import * as React from "react"
import { cn } from "@/src/lib/utils"

const SidebarProvider = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex min-h-screen w-full">{children}</div>
}

const Sidebar = ({ children, collapsible }: { children: React.ReactNode, collapsible?: string }) => {
  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col h-screen sticky top-0">
      {children}
    </aside>
  )
}

const SidebarHeader = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("p-4", className)}>{children}</div>
)

const SidebarContent = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("flex-1 overflow-auto", className)}>{children}</div>
)

const SidebarFooter = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("p-4 mt-auto border-t border-border", className)}>{children}</div>
)

const SidebarGroup = ({ children }: { children: React.ReactNode }) => (
  <div className="py-2">{children}</div>
)

const SidebarGroupContent = ({ children }: { children: React.ReactNode }) => (
  <div>{children}</div>
)

const SidebarMenu = ({ children }: { children: React.ReactNode }) => (
  <ul className="space-y-1 px-2">{children}</ul>
)

const SidebarMenuItem = ({ children }: { children: React.ReactNode }) => (
  <li>{children}</li>
)

const SidebarMenuButton = ({ children, asChild }: { children: React.ReactNode, asChild?: boolean }) => (
  <div className="w-full">{children}</div>
)

const SidebarTrigger = ({ className }: { className?: string }) => (
  <button className={cn("p-2 rounded-md hover:bg-accent", className)}>
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
  </button>
)

const useSidebar = () => ({ state: "expanded" })

export {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
}
