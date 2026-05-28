import { redirect } from "next/navigation";
import { createClient } from "@/src/lib/supabase/server";
import { db } from "@/src/db";
import { profiles } from "@/src/db/schema/profile";
import { eq } from "drizzle-orm";
import { isValidRoleForType } from "@/src/lib/auth/role";

export default async function ClientRootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const profileResult = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  
  const profile = profileResult[0];

  if (!profile) {
    redirect("/auth/sign-in");
  }

  if (isValidRoleForType("lab_portal", profile.role)) {
    redirect("/client/dashboard");
  } else {
    redirect("/admin/dashboard");
  }
}
