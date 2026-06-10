"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,        // data stays fresh 60s — no refetch on re-mount within window
            refetchOnWindowFocus: false,  // stops every tab-switch from firing a network request
            refetchOnReconnect: true,     // sensible: reconnect = stale data, fetch once
            retry: 1,                     // one retry on transient failures, not the default 3
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
