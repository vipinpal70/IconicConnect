import { cn } from "@/src/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; className: string }> = {
    // Database statuses
    scan_received: { label: "Submitted", className: "bg-secondary text-secondary-foreground" },
    allocated_to_designer: { label: "In Design", className: "bg-primary/10 text-primary" },
    scan_verified: { label: "In Validation", className: "bg-blue-100 text-blue-700" },
    scan_not_verified: { label: "On Hold", className: "bg-gray-100 text-gray-700" },
    in_progress: { label: "In Design", className: "bg-primary/10 text-primary" },
    internal_qc: { label: "Internal QC", className: "bg-yellow-100 text-yellow-700" },
    submitted_to_client: { label: "Pending Client Approval", className: "bg-accent text-accent-foreground" },
    on_hold: { label: "On Hold", className: "bg-gray-100 text-gray-700" },
    client_feedback: { label: "Feedback", className: "bg-red-100 text-red-700" },
    approved: { label: "Completed", className: "bg-green-100 text-green-700" },
    delivered: { label: "Completed", className: "bg-green-100 text-green-700" },

    // Fallback/Demo statuses
    Submitted: { label: "Submitted", className: "bg-secondary text-secondary-foreground" },
    "In Validation": { label: "In Validation", className: "bg-blue-100 text-blue-700" },
    "In Design": { label: "In Design", className: "bg-primary/10 text-primary" },
    "Internal QC": { label: "Internal QC", className: "bg-yellow-100 text-yellow-700" },
    "Pending Client Approval": { label: "Pending Client Approval", className: "bg-accent text-accent-foreground" },
    Feedback: { label: "Feedback", className: "bg-red-100 text-red-700" },
    "On Hold": { label: "On Hold", className: "bg-gray-100 text-gray-700" },
    Cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-700 line-through" },
    Completed: { label: "Completed", className: "bg-green-100 text-green-700" },
    active: { label: "Active", className: "bg-green-100 text-green-700" },
    pending: { label: "Pending", className: "bg-yellow-100 text-yellow-700" },
  };

  const config = statusConfig[status] || { label: status, className: "bg-gray-100 text-gray-700" };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
