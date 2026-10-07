"use client"

import QueryProvider from "@/src/providers/query-provider"
import { SessionGuard } from "@/src/components/SessionGuard"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <SessionGuard />
      {children}
    </QueryProvider>
  )
}
