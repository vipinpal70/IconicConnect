export interface LabProfileLike {
  labName?: string | null;
  fullName?: string | null;
  email?: string | null;
}

/**
 * Returns a consistent non-empty display / folder name for a client or profile.
 * Falls back in order: labName -> fullName -> email -> 'Client'.
 * Guarantees 'UnknownLab' is never generated or used for profile identification.
 */
export function getProfileLabName(profile?: LabProfileLike | null): string {
  const labName = profile?.labName?.trim();
  if (labName) return labName;

  const fullName = profile?.fullName?.trim();
  if (fullName) return fullName;

  const email = profile?.email?.trim();
  if (email) return email;

  return 'Client';
}
