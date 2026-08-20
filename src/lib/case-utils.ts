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

/**
 * Admins may cancel at any stage, except once the case has reached a
 * terminal outcome — already cancelled, or signed off as approved/delivered.
 */
const ADMIN_UNCANCELLABLE_STATUSES = ["cancelled", "approved", "delivered"];

export function canAdminCancelCase(status: string): boolean {
  return !ADMIN_UNCANCELLABLE_STATUSES.includes(status);
}

export type CancelCheckResult = { allowed: true } | { allowed: false; reason: string };

/**
 * The single cancellation rule, shared by every interface — client portal,
 * admin portal, ops (QC/designer) portal, milling portal — and enforced
 * server-side in `PUT /api/cases/[id]`, which is the only write path that
 * can set `cancelled`.
 *
 * Cancelling is an admin or case-owner action: QC, designers, account
 * managers and milling users cannot cancel from any status.
 */
export function canCancelCase(role: string, currentStatus: string): CancelCheckResult {
  if (currentStatus === "cancelled") {
    return { allowed: false, reason: "This case has already been cancelled" };
  }

  if (role === "admin") {
    return canAdminCancelCase(currentStatus)
      ? { allowed: true }
      : { allowed: false, reason: "Cannot cancel a case that has already been approved or delivered" };
  }

  if (role === "client" || role === "subuser") {
    return canClientCancelCase(currentStatus)
      ? { allowed: true }
      : {
          allowed: false,
          reason:
            "Cannot cancel case once design work has started. Please contact your account manager.",
        };
  }

  return { allowed: false, reason: "Only an admin or the case owner can cancel a case" };
}
