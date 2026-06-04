import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/src/db'
import { profiles } from '@/src/db/schema/profile'
import { eq } from 'drizzle-orm'

// Simple in-memory rate limiter (Fixed window)
// Note: This is instance-specific. For distributed rate limiting, use Redis.
const rateLimitMap = new Map<string, { count: number; lastReset: number }>()
const RATE_LIMIT = 300
const WINDOW_SIZE = 60 * 1000 // 1 minute

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(key) || { count: 0, lastReset: now }

  if (now - record.lastReset > WINDOW_SIZE) {
    record.count = 1
    record.lastReset = now
  } else {
    record.count++
  }

  rateLimitMap.set(key, record)
  return record.count > RATE_LIMIT
}

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

  // Inside middleware function
  const { data: { user } } = await supabase.auth.getUser()

  // Construct a unique key: use UserID if logged in, otherwise fallback to IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'anonymous'
  const rateLimitKey = user ? `u:${user.id}` : `ip:${ip}`

  if (isRateLimited(rateLimitKey)) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60' }
    })
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
    pathname.startsWith('/api/cases')
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
