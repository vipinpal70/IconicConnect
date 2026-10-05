import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'

import { getClientIp } from '@/src/lib/security/client-ip'
import { rateLimit, SENSITIVE_PATH_LIMITS } from '@/src/lib/security/rate-limit'

const GLOBAL_RATE_LIMIT = 300
const GLOBAL_WINDOW_SECONDS = 60

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

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

  // Inside middleware function
  const { data: { user } } = await supabase.auth.getUser()

  // Rate-limit key: user id when logged in, otherwise the real client IP (never the
  // client-controlled first X-Forwarded-For hop). Redis-backed, shared across processes.
  const ip = getClientIp(request.headers)
  const rateLimitKey = user ? `u:${user.id}` : `ip:${ip}`

  const globalLimit = await rateLimit(`global:${rateLimitKey}`, GLOBAL_RATE_LIMIT, GLOBAL_WINDOW_SECONDS)
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
    pathname === '/api/admin/user' ||
    pathname === '/api/admin/activate'

  // 1. Handle unauthorized access
  if (!user && !isAuthPage && !isSignUpPage && !isPublicApi) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/auth/sign-in', request.url))
  }

  if (user && !isPublicApi) {
    // Fetch profile to get role and parent client ID via Drizzle ORM
    const profileResult = await db
      .select({
        role: profiles.role,
        createdBy: profiles.createdBy,
        status: profiles.status,
      })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1)

    const profile = profileResult[0]
    const role = profile?.role
    const createdBy = profile?.createdBy
    const status = profile?.status

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

  return supabaseResponse
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
    case 'consultant':
      return '/dashboard'
    case 'milling_admin':
    case 'milling_production':
    case 'milling_support':
      return '/milling/dashboard'
    default:
      return '/dashboard'
  }
}

// Milling-centre accounts are third-party partners: they get their own portal and a narrow set of
// shared endpoints — NOT the general /api/cases surface, support, offers, tutorials or preference forms.
// (The one case endpoint they use is /api/cases/<uuid>; the handler additionally checks assignment.)
const MILLING_SHARED_PATHS = [
  '/auth/verify', '/auth/reset-password', '/auth/forgot-password',
  '/profile', '/api/profile', '/notifications', '/api/notifications',
  '/api/notification-preferences', '/api/sidebar-badges',
]
const CASE_DETAIL_PATH = /^\/api\/cases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isAllowedMillingPath(pathname: string): boolean {
  return (
    pathname.startsWith('/milling') ||
    pathname.startsWith('/api/milling') ||
    CASE_DETAIL_PATH.test(pathname) ||
    MILLING_SHARED_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  )
}

function isAllowedPath(role: string | undefined, pathname: string, createdBy: string | null | undefined): boolean {
  if (role === 'milling_admin' || role === 'milling_production' || role === 'milling_support') {
    return isAllowedMillingPath(pathname)
  }

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
        pathname.startsWith('/api/service-pricing') ||
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
        pathname.startsWith('/admin/support') ||
        pathname.startsWith('/api/admin/support') ||
        pathname.startsWith('/api/admin/members') ||
        pathname.startsWith('/api/admin/milling') ||
        pathname.startsWith('/api/tutorials') ||
        pathname.startsWith('/api/offers')
      )
    case 'account_manager':
    case 'consultant':
      return (
        pathname.startsWith('/dashboard') ||
        pathname.startsWith('/cases') ||
        pathname.startsWith('/case') ||
        pathname.startsWith('/analytics') ||
        pathname.startsWith('/admin/support') ||
        pathname.startsWith('/api/admin/support') ||
        pathname.startsWith('/api/admin/members') ||
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
