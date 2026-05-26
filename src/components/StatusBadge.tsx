import { cn } from "@/src/lib/utils";
import { CLIENT_STATUS_LABELS, INTERNAL_STATUS_LABELS } from "@/src/db/schema/case";

export function StatusBadge({ status, role = "client" }: { status: string; role?: "client" | "internal" }) {
  // Map of statuses to aesthetic tailwind color styles
  const statusColors: Record<string, string> = {
    scan_received: "bg-blue-50 text-blue-700 border border-blue-100",
    allocated_to_designer: "bg-primary/10 text-primary border border-primary/20",
    scan_verified: "bg-emerald-50 text-emerald-700 border border-emerald-100",
    scan_not_verified: "bg-red-50 text-red-700 border border-red-100",
    in_progress: "bg-indigo-50 text-indigo-700 border border-indigo-100",
    internal_qc: "bg-amber-50 text-amber-700 border border-amber-100",
    submitted_to_client: "bg-amber-100 text-amber-800 border border-amber-300 font-semibold shadow-sm",
    on_hold: "bg-gray-100 text-gray-700 border border-gray-200",
    client_feedback: "bg-red-50 text-red-700 border border-red-100",
    approved: "bg-green-50 text-green-700 border border-green-200",
    delivered: "bg-green-100 text-green-800 border border-green-200",

    // Fallback/Demo labels
    Submitted: "bg-secondary text-secondary-foreground",
    "In Validation": "bg-blue-100 text-blue-700",
    "In Design": "bg-primary/10 text-primary",
    "Internal QC": "bg-yellow-100 text-yellow-700",
    "Pending Client Approval": "bg-amber-100 text-amber-800 border border-amber-300 font-semibold shadow-sm",
    Feedback: "bg-amber-100 text-amber-800",
    "On Hold": "bg-gray-100 text-gray-700",
    Cancelled: "bg-gray-100 text-gray-700 line-through",
    Completed: "bg-green-100 text-green-700",
    active: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
  };

  // Resolve display label
  let label = status;
  if (role === "internal") {
    label = INTERNAL_STATUS_LABELS[status as keyof typeof INTERNAL_STATUS_LABELS] || status;
  } else {
    label = CLIENT_STATUS_LABELS[status as keyof typeof CLIENT_STATUS_LABELS] || status;
  }

  const className = statusColors[status] || "bg-gray-100 text-gray-700";

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors",
        className,
      )}
    >
      {label}
    </span>
  );
}
