"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/src/lib/utils"

type SidebarContextValue = {
  state: "expanded" | "collapsed"
  mobileOpen: boolean
  toggleSidebar: () => void
  closeMobileSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

const SidebarProvider = ({
  children,
  defaultCollapsed = false,
}: {
  children: React.ReactNode
  defaultCollapsed?: boolean
}) => {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const pathname = usePathname()

  React.useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const value = React.useMemo<SidebarContextValue>(() => ({
    state: collapsed ? "collapsed" : "expanded",
    mobileOpen,
    toggleSidebar: () => {
      if (window.matchMedia("(min-width: 768px)").matches) {
        setCollapsed((current) => !current)
      } else {
        setMobileOpen((current) => !current)
      }
    },
    closeMobileSidebar: () => setMobileOpen(false),
  }), [collapsed, mobileOpen])

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  )
}

const Sidebar = ({
  children,
  collapsible,
  className,
}: {
  children: React.ReactNode
  collapsible?: string
  className?: string
}) => {
  const sidebar = useSidebar()

  return (
    <>
      {sidebar.mobileOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={sidebar.closeMobileSidebar}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}
      <aside
        className={cn(
          "border-r border-border bg-card flex flex-col h-screen sticky top-0 transition-all duration-200 ease-in-out overflow-hidden",
          "fixed inset-y-0 left-0 z-50 w-64 shadow-xl md:shadow-none md:sticky md:z-auto md:translate-x-0",
          sidebar.mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          sidebar.state === "collapsed" ? "md:w-16" : "md:w-64",
          className
        )}
        data-collapsible={collapsible}
        data-state={sidebar.state}
        data-mobile-open={sidebar.mobileOpen}
      >
        {children}
      </aside>
    </>
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

const SidebarTrigger = ({ className }: { className?: string }) => {
  const { state, toggleSidebar } = useSidebar()

  return (
    <button
      type="button"
      aria-label={state === "collapsed" ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={state === "collapsed"}
      onClick={toggleSidebar}
      className={cn("p-2 rounded-md hover:bg-accent transition-colors", className)}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>
  )
}

const useSidebar = () => {
  const context = React.useContext(SidebarContext)

  if (!context) {
    return {
      state: "expanded" as const,
      mobileOpen: false,
      toggleSidebar: () => {},
      closeMobileSidebar: () => {},
    }
  }

  return context
}

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
