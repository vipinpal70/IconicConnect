import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, getSession } from '@/src/lib/auth/session'
import { getClientIp } from '@/src/lib/security/client-ip'
import { rateLimit, SENSITIVE_PATH_LIMITS } from '@/src/lib/security/rate-limit'

const GLOBAL_RATE_LIMIT = 300
const GLOBAL_WINDOW_SECONDS = 60

export async function proxy(request: NextRequest) {
  // CSRF defence in depth (on top of SameSite cookies): a browser-initiated state-changing API call must
  // come from this site. Requests without an Origin header (server-to-server, curl) are unaffected.
  if (request.nextUrl.pathname.startsWith('/api') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost: string | null = null
      try { originHost = new URL(origin).host } catch { /* invalid */ }
      const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
      if (!originHost || originHost !== host) {
        return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
      }
    }
  }

  // Session = ONE Redis GET carrying user id, role, status and effective client id — no Postgres read and
  // no external auth call on the request path. Exposed via Server-Timing so slow requests are traceable.
  const tAuth = performance.now()
  const sid = request.cookies.get(SESSION_COOKIE)?.value
  const session = await getSession(sid)
  const user = session ? { id: session.userId } : null
  const authMs = Math.round(performance.now() - tAuth)

  // Rate-limit key: user id when logged in, otherwise the real client IP (never the
  // client-controlled first X-Forwarded-For hop). Redis-backed, shared across processes.
  const ip = getClientIp(request.headers)
  const rateLimitKey = user ? `u:${user.id}` : `ip:${ip}`

  const tRate = performance.now()
  const globalLimit = await rateLimit(`global:${rateLimitKey}`, GLOBAL_RATE_LIMIT, GLOBAL_WINDOW_SECONDS)
  const rateMs = Math.round(performance.now() - tRate)
  if (globalLimit.limited) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': String(globalLimit.retryAfterSeconds) },
    })
  }

  // Tight per-IP budgets on credential / account-creation endpoints (always by IP so an
  // attacker can't dodge them by rotating accounts).
  const sensitive = request.method !== 'GET' && request.method !== 'HEAD'
    ? SENSITIVE_PATH_LIMITS.find((r) => r.match(request.nextUrl.pathname))
    : undefined
  if (sensitive) {
    const hit = await rateLimit(`${sensitive.name}:ip:${ip}`, sensitive.limit, sensitive.windowSeconds)
    if (hit.limited) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait and try again.' },
        { status: 429, headers: { 'Retry-After': String(hit.retryAfterSeconds) } },
      )
    }
  }

  const pathname = request.nextUrl.pathname
  const isAuthPage = pathname.startsWith('/auth')
  const isRecoveryAuthPage =
    pathname === '/auth/verify' ||
    pathname === '/auth/reset-password' ||
    pathname === '/auth/forgot-password'
  const isSignUpPage = pathname.startsWith('/admin/sign-up')
  const isPublicApi =
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/sign-in') ||
    pathname.startsWith('/api/sign-up') ||
    pathname === '/api/admin/user'

  // 1. Handle unauthorized access
  if (!user && !isAuthPage && !isSignUpPage && !isPublicApi) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/auth/sign-in', request.url))
  }

  // A cookie that no longer maps to a session (expired after 7 h, revoked, or forged) → clear it and re-login.
  if (!user && sid && !isPublicApi && !isAuthPage && !isSignUpPage) {
    const expired = pathname.startsWith('/api')
      ? NextResponse.json({ error: 'Session expired', code: 'session_expired' }, { status: 401 })
      : NextResponse.redirect(new URL('/auth/sign-in?reason=session_expired', request.url))
    expired.cookies.delete(SESSION_COOKIE)
    return expired
  }

  let gateMs = 0
  if (user && !isPublicApi) {
    const role = session!.role
    const createdBy = session!.clientId
    const status = session!.status

    // Allow password recovery routes even when a session already exists.
    // Other auth pages should still redirect authenticated users away.
    const isLegacySubuserPath = pathname.match(/^\/client\/[^/]+\/subuser(\/.*)?$/)

    if (
      (isAuthPage && !isRecoveryAuthPage) ||
      pathname === '/' ||
      pathname === '/admin' ||
      pathname === '/client' ||
      isLegacySubuserPath
    ) {
      return NextResponse.redirect(new URL(getHomeRoute(role, createdBy), request.url))
    }

    if (status !== 'active') {
      if (pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Account is not active' }, { status: 403 })
      }
      return NextResponse.redirect(new URL('/auth/sign-in', request.url))
    }

    // 3. Role-based path protection
    if (!isAllowedPath(role, pathname, createdBy)) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Redirect to their own dashboard if they try to access restricted area
      return NextResponse.redirect(new URL(getHomeRoute(role, createdBy), request.url))
    }
  }

  const finalResponse = NextResponse.next({ request })
  finalResponse.headers.set('Server-Timing', `auth;dur=${authMs}, ratelimit;dur=${rateMs}, gate;dur=${gateMs}`)
  if (authMs + rateMs + gateMs > 800) {
    console.warn(`[perf] slow proxy ${request.method} ${pathname} auth=${authMs}ms ratelimit=${rateMs}ms gate=${gateMs}ms`)
  }
  return finalResponse
}


function getHomeRoute(role: string | undefined, createdBy: string | null | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin/dashboard'
    case 'client':
    case 'subuser':
      return '/client/dashboard'
    case 'qc':
    case 'designer':
    case 'account_manager':
      return '/dashboard'
    default:
      return '/dashboard'
  }
}

function isAllowedPath(role: string | undefined, pathname: string, createdBy: string | null | undefined): boolean {
  // Publicly accessible paths for logged in users (must be checked before role check)
  if (
    pathname === '/auth/verify' ||
    pathname === '/auth/reset-password' ||
    pathname === '/auth/forgot-password' ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/api/profile') ||
    pathname.startsWith('/api/preference-forms') ||
    pathname.startsWith('/client/preferences') ||
    pathname.startsWith('/api/user') ||
    pathname.startsWith('/api/support') ||
    pathname.startsWith('/api/offers') ||
    pathname.startsWith('/api/tutorials') ||
    pathname.startsWith('/admin/sign-up') ||
    pathname.startsWith('/api/cases') ||
    pathname.startsWith('/notifications') ||
    pathname.startsWith('/admin/notifications') ||
    pathname.startsWith('/api/notifications') ||
    pathname.startsWith('/api/notification-preferences') ||
    pathname.startsWith('/api/sidebar-badges')
  )
    return true

  if (!role) return false

  switch (role) {
    case 'admin':
      return (
        pathname.startsWith('/admin') ||
        pathname.startsWith('/api/admin') ||
        pathname.startsWith('/api/billing') ||
        pathname.startsWith('/api/tutorials') ||
        pathname.startsWith('/api/offers') ||
        pathname.startsWith('/api/preference-forms')
      )
    case 'client':
      return pathname.startsWith('/client') || pathname.startsWith('/api/client') || pathname.startsWith('/api/support') || pathname.startsWith('/api/tutorials') || pathname.startsWith('/api/offers') || pathname.startsWith('/client/preferences') || pathname.startsWith('/api/preference-forms')
    case 'subuser':
      return (
        (pathname.startsWith('/client') && !pathname.startsWith('/client/billing')) ||
        (pathname.startsWith('/api/client') && !pathname.startsWith('/api/client/billing')) ||
        pathname.startsWith('/api/support') ||
        pathname.startsWith('/api/tutorials') ||
        pathname.startsWith('/api/offers') ||
        pathname.startsWith('/client/preferences') ||
        pathname.startsWith('/api/preference-forms')
      )
    case 'qc':
    case 'designer':
      return (
        pathname.startsWith('/dashboard') ||
        pathname.startsWith('/cases') ||
        pathname.startsWith('/case') ||
        pathname.startsWith('/analytics') ||
        pathname === '/support' ||
        pathname.startsWith('/admin/support') ||
        pathname.startsWith('/api/admin/support') ||
        pathname.startsWith('/api/admin/members') ||
        pathname === '/api/admin/clients/options' ||
        pathname.startsWith('/api/tutorials') ||
        pathname.startsWith('/api/offers')
      )
    case 'account_manager':
      return (
        pathname.startsWith('/dashboard') ||
        pathname.startsWith('/cases') ||
        pathname.startsWith('/case') ||
        pathname.startsWith('/analytics') ||
        pathname === '/support' ||
        pathname.startsWith('/admin/support') ||
        pathname.startsWith('/api/admin/support') ||
        pathname.startsWith('/api/admin/members') ||
        pathname === '/api/admin/clients/options' ||
        pathname.startsWith('/api/tutorials') ||
        pathname.startsWith('/api/offers')
      )
    default:
      return false
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

export default proxy
