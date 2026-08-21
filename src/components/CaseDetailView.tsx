"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
	ArrowLeft,
	FileText,
	MessageSquare,
	Paperclip,
	Download,
	Factory,
	Truck,
	RefreshCw,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/src/components/ui/card";
import { StatusBadge } from "@/src/components/StatusBadge";
import { CaseChat } from "@/src/components/CaseChat";
import { INTERNAL_STATUS_LABELS } from "@/src/db/schema/case";
import {
	getLifecycleSteps,
	getLifecycleStep,
	type ServiceType,
	type CaseStatus,
} from "@/src/lib/case-status-mapping";
import React, { useState, useRef } from "react";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/src/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/src/components/ui/select";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import {
	HOLD_REASONS,
	canAdminCancelCase,
	canClientCancelCase,
} from "@/src/lib/case-utils";
import { fetchProfileWithCache } from "@/src/lib/profile-cache";
import { Eye, EyeOff, Upload, Trash2 } from "lucide-react";
import type { MillingCenter } from "@/src/db/schema/milling";
import type { RoutingResult } from "@/src/lib/milling/routing-engine";
import { uploadFileInChunks } from "@/src/lib/upload-utils";

const getPreviewFileType = (
	url: string | null | undefined,
): "html" | "image" | "zip" | "other" => {
	if (!url) return "other";
	try {
		const decoded = decodeURIComponent(url);
		let target = decoded;
		if (decoded.includes("fileName=")) {
			const match = decoded.match(/[?&]fileName=([^&]+)/);
			if (match && match[1]) {
				target = match[1];
			}
		} else {
			target = decoded.split("?")[0];
		}
		const extIdx = target.lastIndexOf(".");
		if (extIdx !== -1) {
			const ext = target.substring(extIdx).toLowerCase();
			if ([".html", ".htm"].includes(ext)) return "html";
			if (
				[
					".png",
					".jpg",
					".jpeg",
					".webp",
					".gif",
					".bmp",
					".tiff",
					".tif",
					".svg",
					".heic",
					".heif",
					".ico",
				].includes(ext)
			)
				return "image";
			if (ext === ".zip") return "zip";
		}
	} catch (e) {
		console.error("Error parsing preview file type:", e);
	}
	return "other";
};

type CaseRecord = {
	id: string;
	clientId: string;
	caseNumber: string | null;
	category: string | null;
	subTypeData: Record<string, unknown> | null;
	status: string;
	serviceType?: ServiceType;
	designerId: string | null;
	qcId: string | null;
	accountManagerId: string | null;
	designerName?: string | null;
	qcName?: string | null;
	accountManagerName?: string | null;
	dueDate: string | null;
	timeline: CaseActivity[];
	createdAt: string;
	outputFile?: string | null;
	previewFile?: string | null;
	outputNote?: string | null;
	preferredTeethLibrary?: string | null;
	teethLibraryFileUrl?: string | null;
	teethLibraryFileName?: string | null;
	clientMassage?: string | null;
	holdReason?: string | null;
	cancelReason?: string | null;
	feedbackReason?: string | null;
	rejectReason?: string | null;
	autoApproved?: boolean | null;
};

type CaseFile = {
	id: string;
	fileName: string;
	fileUrl: string;
	note: string | null;
	fileType: string | null;
	fileSize: number | null;
	createdAt: string;
};

type CasePreviewFile = {
	id: string;
	fileName: string;
	fileUrl: string;
	fileType: string | null;
	fileSize: number | null;
	createdAt: string;
};

type CaseActivity = {
	id: string;
	action: string;
	label: string;
	actor: string;
	actionAt: string;
	actionTime?: string;
	clientLabel?: string;
	clientHidden?: boolean;
};

// Always derive from actionAt (UTC) so this renders in the viewer's own
// timezone — actionTime (if present, from older records) was baked in at the
// server's timezone and must not be used for display.
function formatActivityTimestamp(actionAt: string) {
	const date = new Date(actionAt);
	return `${date.toLocaleDateString("en-CA")} at ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

// Milling-stage events must never surface milling terminology, centre names,
// or shipment/tracking detail to the dental lab — filter + relabel before
// rendering to a client (chatSide === "lab").
function toViewerSafeActivities(
	activities: CaseActivity[],
	chatSide: "lab" | "admin",
): CaseActivity[] {
	if (chatSide === "admin") return activities;
	return activities
		.filter((a) => !a.clientHidden)
		.map((a) => (a.clientLabel ? { ...a, label: a.clientLabel } : a));
}

function renderSubTypeSummary(subTypeData: Record<string, unknown> | null) {
	if (!subTypeData) return "—";

	const values = Object.entries(subTypeData)
		.filter(
			([key, value]) =>
				key !== "teeth" &&
				key !== "crownBridgeTeeth" &&
				key !== "toothSystem" &&
				key !== "notes" &&
				key !== "modelRequired" &&
				typeof value === "string" &&
				value &&
				value.toLowerCase() !== "none",
		)
		.map(([, value]) => value as string);

	return values.length ? values.join(" - ") : "—";
}

function formatFileSize(size: number | null) {
	if (!size) return "—";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

const DetailRow = React.memo(function DetailRow({
	label,
	value,
}: {
	label: string;
	value: string | React.ReactNode;
}) {
	return (
		<div className="flex justify-between gap-2 border-b border-border/40 py-2 last:border-b-0">
			<span className="text-xs text-muted-foreground shrink-0">{label}</span>
			<span className="text-xs font-medium text-foreground text-right">
				{value}
			</span>
		</div>
	);
});

const LifecycleStrip = React.memo(function LifecycleStrip({
	status,
	serviceType,
}: {
	status: string;
	serviceType: ServiceType;
}) {
	const steps = getLifecycleSteps(serviceType);
	const currentStep = getLifecycleStep(serviceType, status as CaseStatus);
	const currentIndex = Math.max(steps.indexOf(currentStep ?? "Submitted"), 0);
	// Final success state for the flow — design_only completes at "approved",
	// the other two flows ship physical product and complete at "delivered".
	const isSuccessTerminal = status === "approved" || status === "delivered";

	return (
		<Card className="shadow-card border-emerald-100 bg-[linear-gradient(180deg,rgba(236,253,245,0.9),rgba(240,253,250,0.7))]">
			<CardHeader className="pb-3">
				<CardTitle className="text-sm font-medium text-emerald-900">
					Case Lifecycle
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto pb-2">
					<div className="flex items-center min-w-max">
						{steps.map((step, index) => {
							const done =
								index < currentIndex ||
								step === currentStep ||
								isSuccessTerminal;
							const current = step === currentStep;

							return (
								<div key={step} className="flex items-center">
									<div className="flex flex-col items-center min-w-[100px]">
										<div
											className={[
												"flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors",
												done
													? "border-emerald-600 bg-emerald-600 text-white"
													: "border-emerald-200 bg-white text-emerald-500",
												current
													? "shadow-[0_0_0_5px_rgba(16,185,129,0.14)]"
													: "",
											].join(" ")}
										>
											{done ? "✓" : index + 1}
										</div>
										<span
											className={[
												"mt-2 px-2 text-center text-[11px] font-medium",
												done ? "text-emerald-800" : "text-emerald-500",
											].join(" ")}
										>
											{step}
										</span>
									</div>
									{index < steps.length - 1 && (
										<div
											className={`h-1 w-14 rounded-full ${done ? "bg-emerald-500" : "bg-emerald-100"}`}
										/>
									)}
								</div>
							);
						})}
					</div>
				</div>
			</CardContent>
		</Card>
	);
});

export function CaseDetailView({
	caseId,
	backHref,
	shell,
	chatSide,
}: {
	caseId: string;
	backHref: string;
	shell: (children: React.ReactNode) => React.ReactNode;
	chatSide: "lab" | "admin";
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const chatRef = useRef<HTMLDivElement>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [expandedPreviewIds, setExpandedPreviewIds] = useState<Set<string>>(
		new Set(),
	);
	const [replacingPreviewId, setReplacingPreviewId] = useState<string | null>(
		null,
	);
	const [deletingPreviewId, setDeletingPreviewId] = useState<string | null>(
		null,
	);
	const replacePreviewInputRef = useRef<HTMLInputElement>(null);
	const [isHoldDialogOpen, setIsHoldDialogOpen] = useState(false);
	const [holdReasonSelect, setHoldReasonSelect] = useState("");
	const [holdCustomReason, setHoldCustomReason] = useState("");
	const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false);
	const [changeNotes, setChangeNotes] = useState("");
	const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
	const [rejectNotes, setRejectNotes] = useState("");
	const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
	const [cancelNotes, setCancelNotes] = useState("");
	const [activeTab, setActiveTab] = useState<"details" | "milling">("details");

	// `chatSide === "admin"` covers every internal portal (admin, QC, designer),
	// but cancelling at any stage is an admin-only power — so the actual role
	// is needed, not just the portal side.
	const { data: viewerProfile } = useQuery({
		queryKey: ["profile"],
		queryFn: fetchProfileWithCache,
		staleTime: 5 * 60_000,
	});
	const isAdminViewer = viewerProfile?.role === "admin";

	const handleStatusChange = async (
		targetStatus: string,
		holdReason?: string,
	) => {
		if (targetStatus === "on_hold" && !holdReason) {
			setIsHoldDialogOpen(true);
			setHoldReasonSelect("");
			setHoldCustomReason("");
			return;
		}

		setIsSubmitting(true);
		try {
			const res = await fetch(`/api/cases/${caseId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: targetStatus,
					...(holdReason ? { holdReason } : {}),
				}),
			});
			if (res.ok) {
				toast.success(`Case status updated successfully!`);
				setIsHoldDialogOpen(false);
				await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
				await queryClient.invalidateQueries({
					queryKey: ["case-files", caseId],
				});
				router.refresh();
			} else {
				const err = await res.json();
				toast.error(err.error || "Failed to update case status");
			}
		} catch {
			toast.error("Failed to update case status");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleConfirmHold = () => {
		if (!holdReasonSelect) {
			toast.error("Please select a hold reason.");
			return;
		}
		if (
			holdReasonSelect === "Other (please specify)" &&
			!holdCustomReason.trim()
		) {
			toast.error("Please specify your reason for holding the case.");
			return;
		}
		const finalReason =
			holdReasonSelect === "Other (please specify)"
				? holdCustomReason.trim()
				: holdReasonSelect;
		void handleStatusChange("on_hold", finalReason);
	};

	const handleConfirmChangeRequest = async () => {
		if (!changeNotes.trim()) {
			toast.error("Please describe the changes you are requesting.");
			return;
		}
		setIsSubmitting(true);
		try {
			const res = await fetch(`/api/cases/${caseId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: "change_requested",
					clientMassage: changeNotes.trim(),
				}),
			});
			if (res.ok) {
				await fetch(`/api/cases/${caseId}/chat`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						messageText: `[CHANGE REQUEST]: ${changeNotes.trim()}`,
					}),
				});
				toast.success("Change request submitted successfully!");
				setIsChangeDialogOpen(false);
				setChangeNotes("");
				await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
				await queryClient.invalidateQueries({
					queryKey: ["case-files", caseId],
				});
				router.refresh();
			} else {
				const err = await res.json();
				toast.error(err.error || "Failed to submit change request");
			}
		} catch {
			toast.error("Failed to submit change request");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleRequestChanges = () => {
		setIsChangeDialogOpen(true);
	};

	const handleConfirmReject = async () => {
		if (!rejectNotes.trim()) {
			toast.error("Please describe the reason for rejecting the case.");
			return;
		}
		setIsSubmitting(true);
		try {
			const res = await fetch(`/api/cases/${caseId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: "client_reject",
					clientMassage: rejectNotes.trim(),
				}),
			});
			if (res.ok) {
				await fetch(`/api/cases/${caseId}/chat`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						messageText: `[CASE REJECTED]: ${rejectNotes.trim()}`,
					}),
				});
				toast.success("Case rejected successfully.");
				setIsRejectDialogOpen(false);
				setRejectNotes("");
				await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
				await queryClient.invalidateQueries({
					queryKey: ["case-files", caseId],
				});
				router.refresh();
			} else {
				const err = await res.json();
				toast.error(err.error || "Failed to reject case");
			}
		} catch {
			toast.error("Failed to reject case");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleRejectCase = () => {
		setIsRejectDialogOpen(true);
	};

	const handleCancelCase = () => {
		setCancelNotes("");
		setIsCancelDialogOpen(true);
	};

	const handleConfirmCancel = async () => {
		setIsSubmitting(true);
		try {
			const reason = cancelNotes.trim();
			const res = await fetch(`/api/cases/${caseId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: "cancelled",
					...(reason ? { cancelReason: reason } : {}),
				}),
			});
			if (res.ok) {
				toast.success("Case cancelled.");
				setIsCancelDialogOpen(false);
				setCancelNotes("");
				await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
				await queryClient.invalidateQueries({
					queryKey: ["case-files", caseId],
				});
				router.refresh();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.error || "Failed to cancel case");
			}
		} catch {
			toast.error("Failed to cancel case");
		} finally {
			setIsSubmitting(false);
		}
	};

	const togglePreviewExpanded = (fileId: string) => {
		setExpandedPreviewIds((prev) => {
			const next = new Set(prev);
			if (next.has(fileId)) next.delete(fileId);
			else next.add(fileId);
			return next;
		});
	};

	const handleDeletePreviewFile = async (fileId: string) => {
		if (!confirm("Remove this preview file?")) return;
		setDeletingPreviewId(fileId);
		try {
			const res = await fetch(`/api/cases/${caseId}/preview-files/${fileId}`, {
				method: "DELETE",
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || "Failed to remove preview file");
			}
			await queryClient.invalidateQueries({
				queryKey: ["case-preview-files", caseId],
			});
			toast.success("Preview file removed.");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to remove preview file",
			);
		} finally {
			setDeletingPreviewId(null);
		}
	};

	const handleReplacePreviewFile = async (
		fileId: string,
		file: File,
		clientId: string,
	) => {
		setReplacingPreviewId(fileId);
		try {
			const uploaded = await new Promise<{
				fileUrl: string;
				fileName: string;
				fileType: string;
				fileSize: number | null;
			}>((resolve, reject) => {
				uploadFileInChunks(
					file,
					{ clientId },
					() => {},
					(res) => resolve(res),
					(err) => reject(new Error(err)),
				);
			});
			const createRes = await fetch(`/api/cases/${caseId}/preview-files`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					fileUrl: uploaded.fileUrl,
					fileName: uploaded.fileName,
					fileType: uploaded.fileType,
					fileSize: uploaded.fileSize,
				}),
			});
			if (!createRes.ok) {
				const err = await createRes.json().catch(() => ({}));
				throw new Error(
					err.error || "Failed to upload replacement preview file",
				);
			}
			// Only remove the old row once the new one is safely persisted.
			if (fileId !== "legacy") {
				await fetch(`/api/cases/${caseId}/preview-files/${fileId}`, {
					method: "DELETE",
				}).catch(() => {});
			}
			await queryClient.invalidateQueries({
				queryKey: ["case-preview-files", caseId],
			});
			toast.success("Preview file replaced.");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to replace preview file",
			);
		} finally {
			setReplacingPreviewId(null);
		}
	};

	const {
		data: caseResponse,
		isLoading,
		error,
	} = useQuery<{ data: CaseRecord }>({
		queryKey: ["case", caseId],
		queryFn: async () => {
			const res = await fetch(`/api/cases/${caseId}`);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || "Failed to fetch case");
			}
			return res.json();
		},
		staleTime: 15_000, // case data fetched by detail view; chat polls separately
	});

	const { data: filesResponse } = useQuery<{ data: CaseFile[] }>({
		queryKey: ["case-files", caseId],
		queryFn: async () => {
			const res = await fetch(`/api/cases/${caseId}/files`);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || "Failed to fetch case files");
			}
			return res.json();
		},
		retry: false,
		staleTime: 30_000, // files don't change frequently
	});

	const { data: previewFilesResponse } = useQuery<{ data: CasePreviewFile[] }>({
		queryKey: ["case-preview-files", caseId],
		queryFn: async () => {
			const res = await fetch(`/api/cases/${caseId}/preview-files`);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || "Failed to fetch preview files");
			}
			return res.json();
		},
		retry: false,
		staleTime: 30_000,
	});

	const caseRecord = caseResponse?.data;
	const files = filesResponse?.data || [];
	const previewFiles = previewFilesResponse?.data || [];
	const activities = caseRecord?.timeline || [];
	const displayActivities = toViewerSafeActivities(activities, chatSide);

	if (isLoading) {
		return shell(
			<div className="p-10 text-center text-muted-foreground">
				Loading case details...
			</div>,
		);
	}

	if (error || !caseRecord) {
		return shell(
			<div className="p-10 text-center text-muted-foreground">
				{(error as Error | undefined)?.message || "Case not found"}
			</div>,
		);
	}

	const serviceType: ServiceType = caseRecord.serviceType ?? "design_only";
	// Milling Only cases skip design entirely, so they reach the milling stage
	// right after file verification instead of after design approval — but
	// once there, they use the same Milling tab as Design + Milling.
	const hasMillingTab =
		serviceType === "design_milling" || serviceType === "milling_only";

	const subTypeData = caseRecord.subTypeData || {};
	const teeth = Array.isArray(subTypeData.teeth)
		? (subTypeData.teeth as number[])
		: [];
	const crownBridgeTeeth = Array.isArray(subTypeData.crownBridgeTeeth)
		? (subTypeData.crownBridgeTeeth as number[])
		: [];
	const toothSystem =
		typeof subTypeData.toothSystem === "string"
			? subTypeData.toothSystem
			: "USA";
	const notes = typeof subTypeData.notes === "string" ? subTypeData.notes : "—";
	const modelRequired =
		typeof subTypeData.modelRequired === "string"
			? subTypeData.modelRequired
			: "—";

	return shell(
		<div className="space-y-4 animate-fade-in max-w-6xl mx-auto">
			<div className="flex items-center gap-2.5 flex-wrap">
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					onClick={() => router.push(backHref)}
				>
					<ArrowLeft className="h-4 w-4" />
				</Button>
				<div>
					<h1 className="text-lg font-semibold text-foreground leading-none">
						{caseRecord.caseNumber || caseRecord.id}
					</h1>
					<p className="text-xs text-muted-foreground mt-1">
						{caseRecord.category || "—"} ·{" "}
						{renderSubTypeSummary(caseRecord.subTypeData)}
					</p>
				</div>
				<div className="ml-auto flex items-center gap-2">
					{caseRecord.autoApproved && (
						<span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
							⏱ Auto-Approved
						</span>
					)}
					<StatusBadge
						status={caseRecord.status}
						role={chatSide === "admin" ? "internal" : "client"}
						serviceType={serviceType}
					/>
				</div>
			</div>

			{chatSide === "admin" && hasMillingTab && (
				<div className="flex gap-1.5 border-b border-border">
					<button
						onClick={() => setActiveTab("details")}
						className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
							activeTab === "details"
								? "border-primary text-primary"
								: "border-transparent text-muted-foreground hover:text-foreground"
						}`}
					>
						Details
					</button>
					<button
						onClick={() => setActiveTab("milling")}
						className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
							activeTab === "milling"
								? "border-primary text-primary"
								: "border-transparent text-muted-foreground hover:text-foreground"
						}`}
					>
						<Factory className="h-3.5 w-3.5" /> Milling
					</button>
				</div>
			)}

			{activeTab === "milling" && chatSide === "admin" && hasMillingTab ? (
				<MillingTab caseId={caseRecord.id} timeline={activities} />
			) : (
				<>
					{caseRecord.clientMassage && (
						<div
							className={`p-4 rounded-lg border text-xs font-medium flex flex-col gap-1 ${
								caseRecord.status === "client_reject"
									? "bg-red-50 border-red-200 text-red-800"
									: "bg-amber-50 border-amber-200 text-amber-800"
							}`}
						>
							<span className="font-semibold flex items-center gap-1.5">
								{caseRecord.status === "client_reject"
									? "✗ Rejection Reason"
									: "ℹ Requested Changes"}
							</span>
							<p className="whitespace-pre-wrap font-normal mt-0.5">
								{caseRecord.clientMassage}
							</p>
						</div>
					)}

					{caseRecord.holdReason && (
						<div className="p-4 rounded-lg border-2 border-red-500 bg-red-50 text-red-900 text-xs font-medium flex flex-col gap-1 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]">
							<span className="font-bold flex items-center gap-1.5 text-red-600">
								⏸ On Hold — Reason
							</span>
							<p className="whitespace-pre-wrap font-normal mt-0.5 text-red-800">
								{caseRecord.holdReason}
							</p>
						</div>
					)}

					{caseRecord.cancelReason && (
						<div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 text-xs font-medium flex flex-col gap-1">
							<span className="font-semibold flex items-center gap-1.5">
								🚫 Cancellation Reason
							</span>
							<p className="whitespace-pre-wrap font-normal mt-0.5">
								{caseRecord.cancelReason}
							</p>
						</div>
					)}

					{caseRecord.feedbackReason && (
						<div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-medium flex flex-col gap-1">
							<span className="font-semibold flex items-center gap-1.5">
								💬 QC Feedback
							</span>
							<p className="whitespace-pre-wrap font-normal mt-0.5">
								{caseRecord.feedbackReason}
							</p>
						</div>
					)}

					{caseRecord.rejectReason && (
						<div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs font-medium flex flex-col gap-1">
							<span className="font-semibold flex items-center gap-1.5">
								✗ QC Rejection Reason
							</span>
							<p className="whitespace-pre-wrap font-normal mt-0.5">
								{caseRecord.rejectReason}
							</p>
						</div>
					)}

					<LifecycleStrip
						status={caseRecord.status}
						serviceType={serviceType}
					/>

					{/* Upper Grid: Details & Timeline side-by-side on lg screen */}
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<Card className="shadow-card flex flex-col justify-between">
							<div>
								<CardHeader className="py-2.5 px-4 border-b border-border/50">
									<CardTitle className="text-sm font-semibold">
										Case Details
									</CardTitle>
								</CardHeader>
								<CardContent className="mt-2 px-4 pb-3">
									<DetailRow
										label="Case Number"
										value={caseRecord.caseNumber || caseRecord.id}
									/>
									<DetailRow
										label="Category"
										value={caseRecord.category || "—"}
									/>
									<DetailRow
										label="Case Sub Type"
										value={renderSubTypeSummary(caseRecord.subTypeData)}
									/>
									<DetailRow
										label="Case Files"
										value={
											files.length === 0 ? (
												<span className="text-muted-foreground">—</span>
											) : (
												<div className="flex flex-wrap gap-1 justify-end">
													{files.map((file) => (
														<a
															key={file.id}
															href={file.fileUrl}
															download={file.fileName}
															title={file.fileName}
															className="text-[10px] font-medium text-primary underline underline-offset-2 cursor-pointer hover:text-primary/70 transition-colors"
															onClick={(e) => e.stopPropagation()}
														>
															{file.fileName.length > 15
																? `${file.fileName.slice(0, 15)}…`
																: file.fileName}
														</a>
													))}
												</div>
											)
										}
									/>
									<DetailRow label="Model Required" value={modelRequired} />
									{caseRecord.category === "Implant" ? (
										<>
											<DetailRow
												label="Implant Teeth"
												value={
													teeth.length
														? `#${teeth.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})`
														: "—"
												}
											/>
											{crownBridgeTeeth.length > 0 && (
												<DetailRow
													label="Crown & Bridge Teeth"
													value={`#${crownBridgeTeeth.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})`}
												/>
											)}
										</>
									) : (
										<DetailRow
											label="Teeth"
											value={
												teeth.length
													? `#${teeth.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})`
													: "—"
											}
										/>
									)}
									<DetailRow
										label="Preferred Teeth Library"
										value={
											caseRecord.preferredTeethLibrary === "other" ? (
												caseRecord.teethLibraryFileUrl ? (
													<a
														href={caseRecord.teethLibraryFileUrl}
														download={
															caseRecord.teethLibraryFileName || "teeth_library"
														}
														className="text-primary hover:text-primary/70 underline underline-offset-2 font-medium"
													>
														{caseRecord.teethLibraryFileName ||
															"Other Teeth Library (Download)"}
													</a>
												) : (
													"Other Teeth Library"
												)
											) : (
												"Default Teeth Library"
											)
										}
									/>
									<DetailRow
										label="Designer"
										value={
											caseRecord.designerName || caseRecord.designerId || "—"
										}
									/>
									<DetailRow
										label="QC"
										value={caseRecord.qcName || caseRecord.qcId || "—"}
									/>
									<DetailRow
										label="Account Manager"
										value={
											caseRecord.accountManagerName ||
											caseRecord.accountManagerId ||
											"—"
										}
									/>
									<DetailRow
										label="Submitted"
										value={new Date(caseRecord.createdAt).toLocaleDateString()}
									/>
									<DetailRow
										label="Due Date"
										value={
											caseRecord.dueDate
												? new Date(caseRecord.dueDate).toLocaleDateString()
												: "—"
										}
									/>
									<div className="pt-2.5 border-t border-border/50 mt-2.5">
										<p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
											Notes
										</p>
										<p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
											{notes}
										</p>
									</div>
								</CardContent>
							</div>

							{/* Client Self-Serve Contextual Actions */}
							{chatSide === "lab" && (
								<CardContent className="py-3 px-4 border-t border-border/50 bg-muted/5 rounded-b-lg space-y-2">
									<p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
										Lab Actions
									</p>
									<div className="flex flex-col gap-2">
										{[
											"scan_received",
											"scan_not_verified",
											"scan_verified",
										].includes(caseRecord.status) && (
											<Button
												size="sm"
												variant="secondary"
												className="w-full text-xs font-medium"
												disabled={isSubmitting}
												onClick={() => handleStatusChange("on_hold")}
											>
												⏸{" "}
												{caseRecord.status === "scan_received"
													? "Hold Case"
													: "Put Case on Hold"}
											</Button>
										)}
										{caseRecord.status === "on_hold" && (
											<Button
												size="sm"
												className="w-full text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
												disabled={isSubmitting}
												onClick={() => handleStatusChange("scan_received")}
											>
												▶ Resume Case
											</Button>
										)}
										{/* Cancellable up to the point a designer starts work, plus while on hold. */}
										{canClientCancelCase(caseRecord.status) && (
											<Button
												size="sm"
												variant="destructive"
												className="w-full text-xs font-medium"
												disabled={isSubmitting}
												onClick={handleCancelCase}
											>
												🚫 Cancel Case
											</Button>
										)}
										{caseRecord.status === "submitted_to_client" && (
											<div className="flex flex-col gap-2">
												<Button
													size="sm"
													className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white w-full"
													disabled={isSubmitting}
													onClick={() => handleStatusChange("approved")}
												>
													✓ Approve Case
												</Button>
												<div className="grid grid-cols-2 gap-2">
													<Button
														size="sm"
														variant="outline"
														className="text-xs font-medium text-amber-700 border-amber-200 hover:bg-amber-50"
														onClick={handleRequestChanges}
													>
														✗ Request Changes
													</Button>
													<Button
														size="sm"
														variant="outline"
														className="text-xs font-medium text-red-600 border-red-200 hover:bg-red-50"
														onClick={handleRejectCase}
													>
														🚫 Reject Case
													</Button>
												</div>
											</div>
										)}
										{caseRecord.status === "client_reject" && (
											<p className="text-xs text-red-600 font-semibold text-center py-1 bg-red-50 border border-red-100 rounded-md">
												✗ This case has been rejected.
											</p>
										)}
										{caseRecord.status === "cancelled" && (
											<p className="text-xs text-muted-foreground font-semibold text-center py-1 bg-muted/40 border border-border/60 rounded-md">
												🚫 This case has been cancelled.
											</p>
										)}
										{!canClientCancelCase(caseRecord.status) &&
											![
												"submitted_to_client",
												"client_reject",
												"cancelled",
											].includes(caseRecord.status) && (
												<p className="text-xs text-muted-foreground italic text-center py-1">
													No actions available at this stage.
												</p>
											)}
									</div>
								</CardContent>
							)}
							{chatSide === "admin" && (
								<CardContent className="py-3 px-4 border-t border-border/50 bg-muted/5 rounded-b-lg space-y-2">
									<p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
										Internal Actions
									</p>
									<div className="flex flex-col gap-2">
										{caseRecord.status === "change_requested" && (
											<div className="grid grid-cols-2 gap-2">
												<Button
													size="sm"
													className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
													disabled={isSubmitting}
													onClick={() => handleStatusChange("client_feedback")}
												>
													✓ Accept Request
												</Button>
												<Button
													size="sm"
													variant="outline"
													className="text-xs font-medium text-red-600 border-red-200 hover:bg-red-50"
													disabled={isSubmitting}
													onClick={() =>
														handleStatusChange("submitted_to_client")
													}
												>
													✗ Decline Request
												</Button>
											</div>
										)}
										{caseRecord.status === "client_reject" && (
											<p className="text-xs text-red-600 font-semibold text-center py-1 bg-red-50 border border-red-100 rounded-md">
												✗ This case has been rejected by the client.
											</p>
										)}
										{/* Admins can cancel at any stage short of a terminal outcome. */}
										{isAdminViewer && canAdminCancelCase(caseRecord.status) && (
											<Button
												size="sm"
												variant="destructive"
												className="w-full text-xs font-medium"
												disabled={isSubmitting}
												onClick={handleCancelCase}
											>
												🚫 Cancel Case
											</Button>
										)}
										{caseRecord.status === "cancelled" && (
											<p className="text-xs text-muted-foreground font-semibold text-center py-1 bg-muted/40 border border-border/60 rounded-md">
												🚫 This case has been cancelled.
											</p>
										)}
										{![
											"change_requested",
											"client_reject",
											"cancelled",
										].includes(caseRecord.status) &&
											!(
												isAdminViewer && canAdminCancelCase(caseRecord.status)
											) && (
												<p className="text-xs text-muted-foreground italic text-center py-1">
													No actions available at this stage.
												</p>
											)}
									</div>
								</CardContent>
							)}
						</Card>

						{/* Activity Timeline Card */}
						<Card className="shadow-card flex flex-col h-full">
							<CardHeader className="py-2.5 px-4 border-b border-border/50">
								<CardTitle className="text-sm font-semibold">
									Activity Timeline
								</CardTitle>
							</CardHeader>
							<CardContent className="mt-2 px-4 max-h-[450px] overflow-y-scroll pr-2 custom-scrollbar">
								{displayActivities.length === 0 ? (
									<p className="text-xs text-muted-foreground">
										No activity recorded for this case yet.
									</p>
								) : (
									<div className="space-y-4">
										{displayActivities.map((activity, index) => (
											<div key={activity.id} className="flex gap-3">
												<div className="flex flex-col items-center">
													<div className="mt-1 h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-100 shrink-0" />
													{index < displayActivities.length - 1 && (
														<div className="mt-1.5 w-0.5 flex-1 bg-emerald-200" />
													)}
												</div>
												<div className="pb-1">
													<p className="text-xs font-semibold text-foreground">
														{activity.label}
													</p>
													<p className="text-[10px] text-muted-foreground mt-0.5">
														{formatActivityTimestamp(activity.actionAt)} ·{" "}
														{activity.actor}
													</p>
												</div>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>
					</div>

					{/* Full Width Section: Attachments & Case Chat */}
					<div className="space-y-4">
						{(chatSide === "admin" ||
							["submitted_to_client", "approved", "delivered"].includes(
								caseRecord.status,
							)) &&
							(caseRecord.outputFile || previewFiles.length > 0) && (
								<Card className="shadow-card bg-white">
									<CardHeader className="py-2.5 px-4 border-b border-border/50">
										<CardTitle className="text-sm font-semibold text-black flex items-center gap-2">
											{/* <FileText className="h-4 w-4" /> */}
											Design Deliverables
										</CardTitle>
									</CardHeader>
									<CardContent className="mt-2 px-4 pb-3 space-y-3">
										{caseRecord.outputFile && (
											<div className="flex flex-col justify-between p-4 rounded-lg border border-indigo-100 bg-white shadow-sm hover:shadow-md transition-shadow">
												<div>
													<h4 className="text-sm font-semibold text-gray-900">
														Final Design File
													</h4>
													{caseRecord.outputNote ? (
														<p className="text-s text-red-700 mt-1.5 bg-gray-400 rounded p-2 border border-indigo-100/30 whitespace-pre-wrap">
															{caseRecord.outputNote}
														</p>
													) : (
														<p className="text-xs text-muted-foreground mt-1">
															This is the ready-to-use production CAD/CAM file.
														</p>
													)}
												</div>
												<div className="mt-4">
													<a
														href={caseRecord.outputFile}
														download
														target="_blank"
														rel="noreferrer"
														className="w-full block"
													>
														<Button
															size="sm"
															className="w-full bg-primary hover:bg-primary/80 text-white gap-2 font-medium"
														>
															<Download className="h-4 w-4" /> Download Design
														</Button>
													</a>
												</div>
											</div>
										)}

										{previewFiles.map((file) => {
											const fileType = getPreviewFileType(file.fileUrl);
											const isExpanded = expandedPreviewIds.has(file.id);
											const isZip = fileType === "zip";
											const isReplacing = replacingPreviewId === file.id;
											const isDeleting = deletingPreviewId === file.id;
											return (
												<div
													key={file.id}
													className="rounded-lg border border-indigo-100 bg-white shadow-sm overflow-hidden"
												>
													<div className="flex items-center justify-between gap-3 p-4">
														<div className="min-w-0">
															<h4
																className="text-sm font-semibold text-indigo-950 truncate"
																title={file.fileName}
															>
																{file.fileName}
															</h4>
															<p className="text-xs text-muted-foreground mt-1">
																{isZip
																	? "ZIP archive containing preview assets."
																	: fileType === "image"
																		? "Image preview of the designed case."
																		: "HTML interactive 3D rendering of the case."}
															</p>
														</div>
														<div className="flex items-center gap-1.5 shrink-0">
															{isZip ? (
																<a
																	href={file.fileUrl}
																	download
																	target="_blank"
																	rel="noreferrer"
																>
																	<Button
																		size="sm"
																		className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 font-medium"
																	>
																		<Download className="h-4 w-4" /> Download
																	</Button>
																</a>
															) : (
																<Button
																	size="sm"
																	variant="outline"
																	onClick={() => togglePreviewExpanded(file.id)}
																	className="border-primary/20 text-primary hover:bg-primary/10 font-medium gap-2"
																>
																	{isExpanded ? (
																		<EyeOff className="w-4 h-4" />
																	) : (
																		<Eye className="w-4 h-4" />
																	)}
																	{isExpanded ? "Hide" : "Show"}
																</Button>
															)}
															{chatSide === "admin" && (
																<>
																	<button
																		type="button"
																		title="Replace this preview file"
																		disabled={isReplacing || isDeleting}
																		onClick={() => {
																			setReplacingPreviewId(file.id);
																			replacePreviewInputRef.current?.click();
																		}}
																		className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-50"
																	>
																		<Upload className="h-4 w-4" />
																	</button>
																	{file.id !== "legacy" && (
																		<button
																			type="button"
																			title="Delete this preview file"
																			disabled={isReplacing || isDeleting}
																			onClick={() =>
																				handleDeletePreviewFile(file.id)
																			}
																			className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
																		>
																			<Trash2 className="h-4 w-4" />
																		</button>
																	)}
																</>
															)}
														</div>
													</div>

													{isExpanded && !isZip && (
														<div className="border-t border-indigo-100 bg-zinc-50 shadow-inner">
															<div className="bg-indigo-950/5 border-b border-indigo-100 px-4 py-2 flex items-center justify-between text-xs text-indigo-900 font-medium">
																<span>
																	{fileType === "image"
																		? "Image Preview"
																		: "Interactive HTML Viewer"}
																</span>
																<a
																	href={file.fileUrl}
																	target="_blank"
																	rel="noreferrer"
																	className="text-indigo-600 hover:underline"
																>
																	Open in New Tab ↗
																</a>
															</div>
															<div
																className="w-full flex items-center justify-center bg-zinc-900 overflow-auto"
																style={{ minHeight: "400px" }}
															>
																{fileType === "image" ? (
																	<img
																		src={file.fileUrl}
																		alt={file.fileName}
																		className="max-w-full max-h-[600px] object-contain p-2"
																	/>
																) : (
																	<iframe
																		src={file.fileUrl}
																		className="w-full h-[500px] border-none bg-white"
																		title={file.fileName}
																	/>
																)}
															</div>
														</div>
													)}
												</div>
											);
										})}

										{chatSide === "admin" && (
											<input
												ref={replacePreviewInputRef}
												type="file"
												accept=".html,.htm,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.tif,.svg,.heic,.heif,.ico"
												className="hidden"
												onChange={(e) => {
													const file = e.target.files?.[0];
													const targetId = replacingPreviewId;
													e.target.value = "";
													if (file && targetId)
														void handleReplacePreviewFile(
															targetId,
															file,
															caseRecord.clientId,
														);
													else setReplacingPreviewId(null);
												}}
											/>
										)}
									</CardContent>
								</Card>
							)}

						<div ref={chatRef}>
							<Card className="shadow-card overflow-hidden">
								<CardHeader className="py-2.5 px-4 border-b border-border/50 bg-muted/10">
									<CardTitle className="text-sm font-semibold flex items-center gap-2">
										<MessageSquare className="h-4 w-4 text-primary" />
										Case Chat
										<span className="text-[11px] font-normal text-muted-foreground ml-1">
											— with Iconic Connect Team
										</span>
									</CardTitle>
								</CardHeader>
								<CardContent className="p-0">
									<CaseChat
										caseId={caseRecord.id}
										side={chatSide}
										className="border-none rounded-none"
										heightClass="h-[360px]"
										disabled={caseRecord.status === "client_reject"}
									/>
								</CardContent>
							</Card>
						</div>
					</div>
				</>
			)}

			{/* Hold Reason Dropdown Dialog */}
			<Dialog
				open={isHoldDialogOpen}
				onOpenChange={(open) => {
					if (!open) setIsHoldDialogOpen(false);
				}}
			>
				<DialogContent className="sm:max-w-[480px] bg-white text-gray-900 border border-gray-200 shadow-xl rounded-lg">
					<DialogHeader>
						<DialogTitle className="text-lg font-medium text-gray-900 flex items-center gap-2">
							⏸ Hold Case
						</DialogTitle>
						<p className="text-xs text-gray-500">
							Please specify the reason before putting this case on hold.
						</p>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="space-y-2">
							<Label
								htmlFor="detail-hold-reason-select"
								className="text-sm font-semibold text-gray-700"
							>
								Hold Reason
							</Label>
							<Select
								value={holdReasonSelect}
								onValueChange={setHoldReasonSelect}
							>
								<SelectTrigger
									id="detail-hold-reason-select"
									className="w-full bg-gray-50 border border-gray-300 text-gray-900 focus:ring-emerald-500 rounded-md"
								>
									<SelectValue placeholder="Select a hold reason..." />
								</SelectTrigger>
								<SelectContent className="bg-white border border-gray-200 text-gray-900 shadow-lg rounded-md">
									{HOLD_REASONS.map((reason) => (
										<SelectItem
											key={reason}
											value={reason}
											className="hover:bg-gray-100 focus:bg-gray-100 cursor-pointer"
										>
											{reason}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{holdReasonSelect === "Other (please specify)" && (
							<div className="space-y-2">
								<Label
									htmlFor="detail-hold-custom-reason"
									className="text-sm font-semibold text-gray-700"
								>
									Specify details
								</Label>
								<Textarea
									id="detail-hold-custom-reason"
									value={holdCustomReason}
									onChange={(e) => setHoldCustomReason(e.target.value)}
									placeholder="Please specify other hold reason details..."
									className="min-h-[100px] bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-emerald-500 rounded-md"
								/>
							</div>
						)}
					</div>

					<div className="flex justify-end gap-2 mt-4">
						<Button
							variant="outline"
							onClick={() => setIsHoldDialogOpen(false)}
							className="text-gray-700 border-gray-300 font-normal hover:bg-gray-100"
							disabled={isSubmitting}
						>
							Cancel
						</Button>
						<Button
							onClick={handleConfirmHold}
							disabled={
								isSubmitting ||
								!holdReasonSelect ||
								(holdReasonSelect === "Other (please specify)" &&
									!holdCustomReason.trim())
							}
							className="text-white bg-emerald-600 hover:bg-emerald-700 font-normal rounded-md"
						>
							Confirm
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Request Changes dialog */}
			<Dialog
				open={isChangeDialogOpen}
				onOpenChange={(open) => {
					if (!open) setIsChangeDialogOpen(false);
				}}
			>
				<DialogContent className="sm:max-w-[500px] bg-white text-gray-900 border border-gray-200 shadow-xl rounded-lg">
					<DialogHeader>
						<DialogTitle className="text-lg font-medium text-gray-900 flex items-center gap-2">
							✗ Request Design Changes
						</DialogTitle>
						<p className="text-xs text-gray-500">
							Describe the adjustments you want the designer to make to your
							design.
						</p>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="space-y-2">
							<Label
								htmlFor="detail-change-notes"
								className="text-sm font-semibold text-gray-700"
							>
								Change Requirements / Notes
							</Label>
							<Textarea
								id="detail-change-notes"
								value={changeNotes}
								onChange={(e) => setChangeNotes(e.target.value)}
								placeholder="Specify what modifications are needed (e.g. adjust margins, change thickness, adapt occlusion)..."
								className="min-h-[140px] bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-emerald-500 rounded-md"
							/>
						</div>
					</div>

					<div className="flex justify-end gap-2 mt-2">
						<Button
							variant="outline"
							onClick={() => setIsChangeDialogOpen(false)}
							className="text-gray-700 border-gray-300 font-normal hover:bg-gray-100"
							disabled={isSubmitting}
						>
							Cancel
						</Button>
						<Button
							onClick={handleConfirmChangeRequest}
							disabled={isSubmitting || !changeNotes.trim()}
							className="text-white bg-emerald-600 hover:bg-emerald-700 font-normal rounded-md"
						>
							Submit Request
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Reject Case dialog */}
			<Dialog
				open={isRejectDialogOpen}
				onOpenChange={(open) => {
					if (!open) setIsRejectDialogOpen(false);
				}}
			>
				<DialogContent className="sm:max-w-[500px] bg-white text-gray-900 border border-gray-200 shadow-xl rounded-lg">
					<DialogHeader>
						<DialogTitle className="text-lg font-medium text-gray-900 flex items-center gap-2">
							🚫 Reject Case Design
						</DialogTitle>
						<p className="text-xs text-gray-500">
							Please specify the reason for rejecting this case. This will
							permanently reject the case and halt all work.
						</p>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="space-y-2">
							<Label
								htmlFor="detail-reject-notes"
								className="text-sm font-semibold text-gray-700"
							>
								Rejection Reason / Notes
							</Label>
							<Textarea
								id="detail-reject-notes"
								value={rejectNotes}
								onChange={(e) => setRejectNotes(e.target.value)}
								placeholder="Describe why you are rejecting this design..."
								className="min-h-[140px] bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-red-500 rounded-md"
							/>
						</div>
					</div>

					<div className="flex justify-end gap-2 mt-2">
						<Button
							variant="outline"
							onClick={() => setIsRejectDialogOpen(false)}
							className="text-gray-700 border-gray-300 font-normal hover:bg-gray-100"
							disabled={isSubmitting}
						>
							Cancel
						</Button>
						<Button
							onClick={handleConfirmReject}
							disabled={isSubmitting || !rejectNotes.trim()}
							className="text-white bg-red-600 hover:bg-red-700 font-normal rounded-md"
						>
							Confirm Rejection
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Cancel Case confirmation dialog */}
			<Dialog
				open={isCancelDialogOpen}
				onOpenChange={(open) => {
					if (!open && !isSubmitting) setIsCancelDialogOpen(false);
				}}
			>
				<DialogContent className="sm:max-w-[500px] bg-white text-gray-900 border border-gray-200 shadow-xl rounded-lg">
					<DialogHeader>
						<DialogTitle className="text-lg font-medium text-gray-900 flex items-center gap-2">
							🚫 Cancel Case
						</DialogTitle>
						<p className="text-xs text-gray-500">
							Are you sure you want to cancel case {caseRecord.caseNumber || ""}
							? This stops all work on the case and cannot be undone.
						</p>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="space-y-2">
							<Label
								htmlFor="detail-cancel-notes"
								className="text-sm font-semibold text-gray-700"
							>
								Cancellation Reason{" "}
								<span className="font-normal text-gray-400">(optional)</span>
							</Label>
							<Textarea
								id="detail-cancel-notes"
								value={cancelNotes}
								onChange={(e) => setCancelNotes(e.target.value)}
								placeholder="Add a note about why this case is being cancelled..."
								className="min-h-[110px] bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-red-500 rounded-md"
							/>
						</div>
					</div>

					<div className="flex justify-end gap-2 mt-2">
						<Button
							variant="outline"
							onClick={() => setIsCancelDialogOpen(false)}
							className="text-gray-700 border-gray-300 font-normal hover:bg-gray-100"
							disabled={isSubmitting}
						>
							Keep Case
						</Button>
						<Button
							onClick={handleConfirmCancel}
							disabled={isSubmitting}
							className="text-white bg-red-600 hover:bg-red-700 font-normal rounded-md"
						>
							{isSubmitting ? "Cancelling..." : "Yes, Cancel Case"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>,
	);
}

interface MillingAssignmentView {
	id: string;
	millingCenterId: string;
	millingCenterName: string | null;
	millingStatus: string;
	carrier: string | null;
	trackingNumber: string | null;
	shipmentEta: string | null;
	notes: string | null;
	assignedAt: string;
}

function MillingTab({
	caseId,
	timeline,
}: {
	caseId: string;
	timeline: CaseActivity[];
}) {
	const queryClient = useQueryClient();
	const [selectedCenterId, setSelectedCenterId] = useState("");
	const [designNotes, setDesignNotes] = useState("");
	const [reassigning, setReassigning] = useState(false);

	const { data, isLoading } = useQuery<{
		assignment: MillingAssignmentView | null;
		recommendation: RoutingResult | null;
	}>({
		queryKey: ["case-milling-assign", caseId],
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
				body: JSON.stringify({
					millingCenterId: centerId,
					notes: designNotes || undefined,
				}),
			});
			if (!res.ok)
				throw new Error(
					(await res.json().catch(() => ({}))).error || "Failed to assign",
				);
			return res.json();
		},
		onSuccess: () => {
			toast.success("Case assigned to milling centre");
			setReassigning(false);
			setSelectedCenterId("");
			queryClient.invalidateQueries({
				queryKey: ["case-milling-assign", caseId],
			});
			queryClient.invalidateQueries({ queryKey: ["case", caseId] });
		},
		onError: (err: Error) => toast.error(err.message),
	});

	if (isLoading) {
		return (
			<div className="p-10 text-center text-muted-foreground text-xs">
				Loading milling info…
			</div>
		);
	}

	const assignment = data?.assignment ?? null;
	const recommendation = data?.recommendation ?? null;
	const activeCenters = centers.filter((c) => c.active);
	const millingActivities = timeline.filter((t) =>
		t.action.startsWith("case.milling"),
	);

	return (
		<div className="space-y-4">
			{!assignment || reassigning ? (
				<Card className="shadow-card">
					<CardHeader className="py-2.5 px-4 border-b border-border/50">
						<CardTitle className="text-sm font-semibold flex items-center gap-2">
							<Factory className="h-4 w-4" />
							{reassigning
								? "Re-assign to a different centre"
								: "Assign to Milling Centre"}
						</CardTitle>
					</CardHeader>
					<CardContent className="p-4 space-y-4">
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
									onClick={() =>
										assignMutation.mutate(recommendation.primary!.center.id)
									}
								>
									Accept recommendation
								</Button>
							</div>
						)}

						<div className="space-y-2">
							<Label className="text-xs">
								{recommendation?.primary
									? "Or pick a different centre"
									: "Pick a milling centre"}
							</Label>
							<Select
								value={selectedCenterId}
								onValueChange={setSelectedCenterId}
							>
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

						<div className="space-y-2">
							<Label className="text-xs">
								Design notes for the milling centre (no client info)
							</Label>
							<Textarea
								rows={3}
								value={designNotes}
								onChange={(e) => setDesignNotes(e.target.value)}
								placeholder="Manufacturing instructions, material, shade, etc."
							/>
						</div>

						<div className="flex gap-2">
							<Button
								size="sm"
								disabled={!selectedCenterId || assignMutation.isPending}
								onClick={() => assignMutation.mutate(selectedCenterId)}
							>
								{assignMutation.isPending ? "Assigning…" : "Assign"}
							</Button>
							{reassigning && (
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setReassigning(false)}
								>
									Cancel
								</Button>
							)}
						</div>
					</CardContent>
				</Card>
			) : (
				<>
					<Card className="shadow-card">
						<CardHeader className="py-2.5 px-4 border-b border-border/50">
							<CardTitle className="text-sm font-semibold">
								Milling Assignment
							</CardTitle>
						</CardHeader>
						<CardContent className="p-4 space-y-2 text-sm">
							<DetailRow
								label="Assigned centre"
								value={assignment.millingCenterName ?? "—"}
							/>
							<DetailRow
								label="Milling status"
								value={
									INTERNAL_STATUS_LABELS[
										assignment.millingStatus as keyof typeof INTERNAL_STATUS_LABELS
									] ?? assignment.millingStatus
								}
							/>
							<DetailRow
								label="Assigned"
								value={new Date(assignment.assignedAt).toLocaleString()}
							/>
							{assignment.notes && (
								<DetailRow label="Design notes" value={assignment.notes} />
							)}
							<Button
								size="sm"
								variant="outline"
								className="mt-2 gap-1.5"
								onClick={() => setReassigning(true)}
							>
								<RefreshCw className="h-3.5 w-3.5" /> Re-assign to a different
								centre
							</Button>
						</CardContent>
					</Card>

					<Card className="shadow-card">
						<CardHeader className="py-2.5 px-4 border-b border-border/50">
							<CardTitle className="text-sm font-semibold flex items-center gap-2">
								<Truck className="h-4 w-4" />
								Shipment
							</CardTitle>
						</CardHeader>
						<CardContent className="p-4 space-y-2 text-sm">
							<DetailRow label="Carrier" value={assignment.carrier ?? "—"} />
							<DetailRow
								label="Tracking number"
								value={assignment.trackingNumber ?? "—"}
							/>
							<DetailRow
								label="ETA"
								value={
									assignment.shipmentEta
										? new Date(assignment.shipmentEta).toLocaleDateString()
										: "—"
								}
							/>
						</CardContent>
					</Card>
				</>
			)}

			<Card className="shadow-card">
				<CardHeader className="py-2.5 px-4 border-b border-border/50">
					<CardTitle className="text-sm font-semibold">
						Milling-stage timeline
					</CardTitle>
				</CardHeader>
				<CardContent className="p-4">
					{millingActivities.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							No milling activity recorded yet.
						</p>
					) : (
						<div className="space-y-3">
							{millingActivities.map((activity) => (
								<div key={activity.id} className="flex gap-3">
									<div className="mt-1 h-2 w-2 rounded-full bg-primary ring-4 ring-primary/10 shrink-0" />
									<div>
										<p className="text-xs font-semibold text-foreground">
											{activity.label}
										</p>
										<p className="text-[10px] text-muted-foreground mt-0.5">
											{formatActivityTimestamp(activity.actionAt)} ·{" "}
											{activity.actor}
										</p>
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
