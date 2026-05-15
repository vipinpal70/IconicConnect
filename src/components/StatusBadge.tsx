import { cn } from "@/src/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, string> = {
    Submitted: "bg-secondary text-secondary-foreground",
    "In Validation": "bg-blue-100 text-blue-700",
    "In Design": "bg-primary/10 text-primary",
    "Internal QC": "bg-yellow-100 text-yellow-700",
    "Pending Client Approval": "bg-accent text-accent-foreground",
    Feedback: "bg-red-100 text-red-700",
    "On Hold": "bg-gray-100 text-gray-700",
    Cancelled: "bg-gray-100 text-gray-700 line-through",
    Completed: "bg-green-100 text-green-700",
    active: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap",
        statusConfig[status] || "bg-gray-100 text-gray-700",
      )}
    >
      {status}
    </span>
  );
}
