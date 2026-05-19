import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/src/lib/supabase/server';

function getPublicOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}

function getSafeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/')) {
    return '/auth/reset-password';
  }

  return next;
}

export async function GET(request: NextRequest) {
  const requestUrl = request.nextUrl;
  const publicOrigin = getPublicOrigin(request);
  const token_hash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type') as EmailOtpType | null;
  const next = getSafeNextPath(requestUrl.searchParams.get('next'));

  if (token_hash && type) {
    const supabase = await createClient();
    
    // Exchange the token_hash for a session
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (!error) {
      // Token verified successfully, redirect to the next page
      return NextResponse.redirect(new URL(next, publicOrigin));
    } else {
      console.error('Verify OTP error:', error.message);
      // Redirect to the reset password page with an explicit error message
      return NextResponse.redirect(
        new URL(`/auth/reset-password?error=${encodeURIComponent(error.message)}`, publicOrigin)
      );
    }
  }

  // If token_hash or type is missing, it's a bad request
  return NextResponse.redirect(
    new URL(`/auth/reset-password?error=${encodeURIComponent('Invalid recovery link.')}`, publicOrigin)
  );
}
