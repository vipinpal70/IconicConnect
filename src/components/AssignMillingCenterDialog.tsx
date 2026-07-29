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
import type { MillingCenter } from "@/src/db/schema/milling";
import type { RoutingResult } from "@/src/lib/milling/routing-engine";

interface MillingAssignmentView {
	millingCenterId: string;
	millingCenterName: string | null;
}

export function AssignMillingCenterDialog({
	caseId,
	caseNumber,
	open,
	onOpenChange,
	onAssigned,
}: {
	caseId: string;
	caseNumber?: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAssigned?: () => void;
}) {
	const queryClient = useQueryClient();
	const [selectedCenterId, setSelectedCenterId] = useState("");
	const [notes, setNotes] = useState("");

	const { data, isLoading } = useQuery<{
		assignment: MillingAssignmentView | null;
		recommendation: RoutingResult | null;
	}>({
		queryKey: ["case-milling-assign", caseId],
		enabled: open,
		queryFn: async () => {
			const res = await fetch(`/api/cases/${caseId}/milling-assign`);
			if (!res.ok)
				throw new Error(
					(await res.json().catch(() => ({}))).error ||
						"Failed to load milling assignment",
				);
			return (await res.json()).data;
		},
	});

	const { data: centers = [] } = useQuery<MillingCenter[]>({
		queryKey: ["admin-milling-centers-active"],
		enabled: open,
		queryFn: async () => {
			const res = await fetch("/api/admin/milling/centers");
			if (!res.ok) return [];
			return (await res.json()).data ?? [];
		},
	});

	const assignMutation = useMutation({
		mutationFn: async (centerId: string) => {
			const res = await fetch(`/api/cases/${caseId}/milling-assign`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ millingCenterId: centerId, notes: notes || undefined }),
			});
			if (!res.ok)
				throw new Error(
					(await res.json().catch(() => ({}))).error || "Failed to assign",
				);
			return res.json();
		},
		onSuccess: () => {
			toast.success("Case assigned to milling centre");
			queryClient.invalidateQueries({ queryKey: ["case-milling-assign", caseId] });
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
			setNotes("");
		}
		onOpenChange(v);
	};

	const recommendation = data?.recommendation ?? null;
	const activeCenters = centers.filter((c) => c.active);

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-sm">
						<Factory className="h-4 w-4" />
						Select milling centre{caseNumber ? ` · ${caseNumber}` : ""}
					</DialogTitle>
				</DialogHeader>

				{isLoading ? (
					<p className="text-xs text-muted-foreground py-6 text-center">Loading…</p>
				) : (
					<div className="space-y-4 mt-1">
						{recommendation?.primary && (
							<div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
								<p className="font-semibold text-foreground">
									Recommended: {recommendation.primary.center.name}
								</p>
								<p className="text-muted-foreground mt-0.5">
									Current load: {recommendation.primary.currentLoad} active case
									{recommendation.primary.currentLoad === 1 ? "" : "s"}
									{recommendation.matchedRule
										? ` · matched rule "${recommendation.matchedRule.name}"`
										: ""}
								</p>
								{recommendation.fallback && (
									<p className="text-muted-foreground mt-0.5">
										Fallback: {recommendation.fallback.center.name}
									</p>
								)}
								<Button
									size="sm"
									className="mt-2"
									disabled={assignMutation.isPending}
									onClick={() => assignMutation.mutate(recommendation.primary!.center.id)}
								>
									Accept recommendation
								</Button>
							</div>
						)}

						<div className="space-y-1.5">
							<Label className="text-xs">
								{recommendation?.primary ? "Or pick a different centre" : "Pick a milling centre"}
							</Label>
							<Select value={selectedCenterId} onValueChange={setSelectedCenterId}>
								<SelectTrigger className="h-9">
									<SelectValue placeholder="Select an active centre" />
								</SelectTrigger>
								<SelectContent>
									{activeCenters.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs">Design notes for the milling centre (no client info)</Label>
							<Textarea
								rows={3}
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								placeholder="Manufacturing instructions, material, shade, etc."
							/>
						</div>

						<Button
							className="w-full"
							disabled={!selectedCenterId || assignMutation.isPending}
							onClick={() => assignMutation.mutate(selectedCenterId)}
						>
							{assignMutation.isPending ? "Assigning…" : "Assign"}
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
