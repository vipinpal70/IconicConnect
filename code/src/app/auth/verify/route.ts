import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const token_hash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type') as any;
  const next = requestUrl.searchParams.get('next') || '/auth/reset-password';

  if (token_hash && type) {
    const supabase = await createClient();
    
    // Exchange the token_hash for a session
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (!error) {
      // Token verified successfully, redirect to the next page
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    } else {
      console.error('Verify OTP error:', error.message);
      // Redirect to the reset password page with an explicit error message
      return NextResponse.redirect(
        new URL(`/auth/reset-password?error=${encodeURIComponent(error.message)}`, requestUrl.origin)
      );
    }
  }

  // If token_hash or type is missing, it's a bad request
  return NextResponse.redirect(
    new URL(`/auth/reset-password?error=${encodeURIComponent('Invalid recovery link.')}`, requestUrl.origin)
  );
}
