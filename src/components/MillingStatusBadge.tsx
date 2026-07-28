import { cn } from "@/src/lib/utils";
import { INTERNAL_STATUS_LABELS } from "@/src/db/schema/case";
import type { millingStatusEnum } from "@/src/db/schema/milling";

export type MillingStatus = (typeof millingStatusEnum.enumValues)[number];

const STATUS_COLORS: Record<MillingStatus, string> = {
  ready_for_milling: "bg-blue-50 text-blue-700 border border-blue-100",
  milling_in_progress: "bg-primary/10 text-primary border border-primary/20",
  milling_qc: "bg-amber-50 text-amber-700 border border-amber-100",
  packaging: "bg-indigo-50 text-indigo-700 border border-indigo-100",
  dispatched: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  delivered: "bg-green-100 text-green-800 border border-green-200",
};

export function MillingStatusBadge({ status }: { status: MillingStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors",
        STATUS_COLORS[status]
      )}
    >
      {INTERNAL_STATUS_LABELS[status]}
    </span>
  );
}
