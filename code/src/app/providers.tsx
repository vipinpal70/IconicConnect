"use client"

import QueryProvider from "@/src/providers/query-provider"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      {children}
    </QueryProvider>
  )
}
