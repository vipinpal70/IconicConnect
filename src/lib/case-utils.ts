export const CATEGORY_PREFIXES: Record<string, string> = {
  "Crown & Bridge": "CAB",
  "Dentures": "CDT",
  "Cosmetics": "CCA",
  "Appliances": "CAP",
  "Implants": "CAI",
  "3D Model": "3DM"
};

export function getCasePrefix(category: string): string {
  return CATEGORY_PREFIXES[category] || category
    .split(/[\s&]+/)
    .map(word => word[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, 'X');
}

export function formatCaseNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export function generateCaseId(category: string): string {
  return getCasePrefix(category);
}

export const HOLD_REASONS = [
  "Scan has artifacts",
  "Scan is not good",
  "Bite is not Aligned",
  "Margin is not good",
  "Order set-up seems Wrong",
  "No space to design crown/implant",
  "Implant Kit not found",
  "Scans missing",
  "Other (please specify)"
] as const;

/**
 * Statuses a client (or their sub-user) may cancel a case from: anything
 * before design work has actually started, plus a case parked on hold.
 * From `in_progress` onwards a designer is already working on the case, so
 * only an admin can cancel it.
 */
export const CLIENT_CANCELLABLE_STATUSES = [
  "scan_received",
  "scan_not_verified",
  "scan_verified",
  "allocated_to_designer",
  "on_hold",
] as const;

export function canClientCancelCase(status: string): boolean {
  return (CLIENT_CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

/** A case already in a cancelled state can't be cancelled again. */
export function canAdminCancelCase(status: string): boolean {
  return status !== "cancelled";
}
