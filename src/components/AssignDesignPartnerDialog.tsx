"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/src/components/ui/select";
import { Factory } from "lucide-react";
import { toast } from "sonner";

interface EligibleCenter {
	id: string;
	name: string;
	partnerRate: string;
	unitType: string;
	turnaroundDays: number | null;
}

interface QcOption {
	id: string;
	fullName: string | null;
}

/**
 * "Assign to Design Partner" — case-flow-update-plan.md §6.1/§7.2/§7.3.
 * Hands the design leg of a Design Only / Design + Milling case to an
 * eligible Milling Centre instead of an internal designer. Admin/QC only.
 * A QC lead must be picked in the same action — the centre has no way to
 * pick one itself. For a Design + Milling case, "This centre will also mill
 * the case" commits the production leg to the same centre up front (Flow 3)
 * so QC's approval auto-advances it into production with no second pick.
 */
export function AssignDesignPartnerDialog({
	caseId,
	caseNumber,
	serviceType,
	qcs,
	open,
	onOpenChange,
	onAssigned,
}: {
	caseId: string;
	caseNumber?: string | null;
	serviceType: "design_only" | "design_milling" | "milling_only";
	qcs: QcOption[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAssigned?: () => void;
}) {
	const queryClient = useQueryClient();
	const [selectedCenterId, setSelectedCenterId] = useState("");
	const [selectedQcId, setSelectedQcId] = useState("");
	const [notes, setNotes] = useState("");
	const [autoAdvance, setAutoAdvance] = useState(false);

	const { data, isLoading } = useQuery<{
		eligibleCenters: EligibleCenter[];
		canAutoAdvance: boolean;
	}>({
		queryKey: ["case-design-assign", caseId],
		enabled: open,
		queryFn: async () => {
			const res = await fetch(`/api/cases/${caseId}/design-assign`);
			if (!res.ok)
				throw new Error(
					(await res.json().catch(() => ({}))).error ||
						"Failed to load design-partner options",
				);
			return (await res.json()).data;
		},
	});

	const assignMutation = useMutation({
		mutationFn: async () => {
			const res = await fetch(`/api/cases/${caseId}/design-assign`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					centerId: selectedCenterId,
					qcId: selectedQcId,
					autoAdvanceToMilling: autoAdvance,
					notes: notes || undefined,
				}),
			});
			if (!res.ok)
				throw new Error(
					(await res.json().catch(() => ({}))).error || "Failed to assign",
				);
			return res.json();
		},
		onSuccess: () => {
			toast.success("Case assigned to design partner");
			queryClient.invalidateQueries({ queryKey: ["admin-cases"] });
			queryClient.invalidateQueries({ queryKey: ["admin-milling-cases-list"] });
			onAssigned?.();
			handleClose(false);
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const handleClose = (v: boolean) => {
		if (!v) {
			setSelectedCenterId("");
			setSelectedQcId("");
			setNotes("");
			setAutoAdvance(false);
		}
		onOpenChange(v);
	};

	const eligibleCenters = data?.eligibleCenters ?? [];
	const canAutoAdvance = serviceType === "design_milling" && (data?.canAutoAdvance ?? false);

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-sm">
						<Factory className="h-4 w-4" />
						Assign to Design Partner{caseNumber ? ` · ${caseNumber}` : ""}
					</DialogTitle>
				</DialogHeader>

				{isLoading ? (
					<p className="text-xs text-muted-foreground py-6 text-center">Loading…</p>
				) : (
					<div className="space-y-4 mt-1">
						<div className="space-y-1.5">
							<Label className="text-xs">Design partner centre</Label>
							<Select value={selectedCenterId} onValueChange={setSelectedCenterId}>
								<SelectTrigger className="h-9">
									<SelectValue placeholder="Select an eligible centre" />
								</SelectTrigger>
								<SelectContent>
									{eligibleCenters.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name} · {c.partnerRate}/{c.unitType.replace("per_", "")}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{eligibleCenters.length === 0 && (
								<p className="text-[11px] text-muted-foreground">
									No centre has this restoration enabled and priced for design under this flow yet.
								</p>
							)}
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">
								QC lead (required — the centre can&apos;t pick one itself)
							</Label>
							<Select value={selectedQcId} onValueChange={setSelectedQcId}>
								<SelectTrigger className="h-9">
									<SelectValue placeholder="Select a QC lead" />
								</SelectTrigger>
								<SelectContent>
									{qcs.map((qc) => (
										<SelectItem key={qc.id} value={qc.id}>
											{qc.fullName ?? "Unnamed QC"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{canAutoAdvance && (
							<label className="flex items-start gap-2 text-xs cursor-pointer">
								<input
									type="checkbox"
									checked={autoAdvance}
									onChange={(e) => setAutoAdvance(e.target.checked)}
									className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
								/>
								<span>
									<span className="font-medium">This centre will also mill the case.</span>{" "}
									Once QC approves, it goes straight to this centre for production —
									no separate milling assignment step.
								</span>
							</label>
						)}

						<div className="space-y-1.5">
							<Label className="text-xs">Notes for the design partner (no client info)</Label>
							<Textarea
								rows={3}
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								placeholder="Design instructions, material, shade, etc."
							/>
						</div>

						<Button
							className="w-full"
							disabled={!selectedCenterId || !selectedQcId || assignMutation.isPending}
							onClick={() => assignMutation.mutate()}
						>
							{assignMutation.isPending ? "Assigning…" : "Assign"}
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
