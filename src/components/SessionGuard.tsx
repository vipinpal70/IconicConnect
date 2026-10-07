"use client"

import { useEffect } from "react"

/**
 * Dashboards are client-rendered and poll /api/*. When the 7-hour login window closes the proxy answers
 * those calls with 401, which would otherwise leave a stale page. Send the user to sign in instead.
 * (The sign-in call itself returns 401 for a wrong password, so it is excluded.)
 */
export function SessionGuard() {
  useEffect(() => {
    const original = window.fetch
    window.fetch = async (...args) => {
      const res = await original(...args)
      if (res.status === 401 && !window.location.pathname.startsWith("/auth")) {
        const input = args[0]
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const path = new URL(url, window.location.origin)
        if (path.origin === window.location.origin && path.pathname.startsWith("/api/") && path.pathname !== "/api/sign-in") {
          window.location.assign("/auth/sign-in?reason=session_expired")
        }
      }
      return res
    }
    return () => { window.fetch = original }
  }, [])
  return null
}
