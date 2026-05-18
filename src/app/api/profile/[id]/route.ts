/**
 * create a get route to fetch user profiles
 * It should fetch data from the profiles table
 * It should return the profile data in JSON format
 * It should use Supabase to fetch data
 * It should use the authenticated user's ID to fetch data
 * 
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.log(`[api/profile/[id]] Unauthorized access: authError=${!!authError}, user=${!!user}`);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch the authenticated requester's profile to determine if they are an admin
    const { data: authUserProfile } = await supabase
      .from('profiles')
      .select('user_type, user_role')
      .eq('id', user.id)
      .single();

    const isAdmin = authUserProfile && (authUserProfile.user_type === 'admin_portal' || authUserProfile.user_role === 'admin');

    // Ensure the authenticated user is fetching their own profile OR is an admin
    if (user.id !== id && !isAdmin) {
      console.log(`[api/profile/[id]] Forbidden access: user.id="${user.id}" !== id="${id}" (requester is not admin)`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Use Supabase client to fetch the requested profile by its ID
    console.log(`[api/profile/[id]] Fetching profile from db for requested ID: "${id}"`);
    const { data: profile, error: dbError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (dbError || !profile) {
      console.error(`[api/profile/[id]] Error fetching profile from db for "${id}":`, dbError);
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Map database snake_case columns to camelCase properties for frontend consistency
    const mappedProfile = {
      id: profile.id,
      userType: profile.user_type,
      role: profile.user_role,
      status: profile.user_status,
      plan: profile.plan_status,
      fullName: profile.full_name,
      name: profile.full_name, // convenient alias
      title: profile.title,
      email: profile.email,
      phone: profile.phone,
      labName: profile.lab_name,
      postalCode: profile.postal_code,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      createdBy: profile.created_by,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
      onBoardedAt: profile.onboarded_at,
    };

    return NextResponse.json(mappedProfile);
  } catch (error) {
    console.error('[api/profile/[id]] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
