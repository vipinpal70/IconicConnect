"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { Upload, Trash2 } from "lucide-react";
import { uploadFileInChunks } from "@/src/lib/upload-utils";

// Not yet attached to the case — uploaded to R2 but only committed to
// case_hold_files once the caller's own "Confirm" action PUTs `holdImages` to
// /api/cases/[id], so cancelling the dialog never leaves orphaned rows
// (hold_images-plan.md §4.2).
export type PendingHoldImage = {
	fileName: string;
	fileUrl: string;
	fileType: string;
	fileSize: number;
};

type ExistingHoldFile = { fileName: string; fileSize: number | null };

export const MAX_HOLD_IMAGES = 5;

// Only JPG/PNG/WEBP — HEIC (default iPhone camera format) has no decoder in
// most non-Apple browsers and would render as a broken image for most
// viewers; SVG is excluded too since it's executable XML, not a photo
// (hold_images-plan.md §4.6/§4.7).
const HOLD_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HOLD_IMAGE_SIZE = 15 * 1024 * 1024; // 15MB — a phone photo, not scan data

/**
 * Staged (not-yet-committed) hold-image picker — shared by every "Put on
 * Hold" surface (case detail page, admin/QC cases-list quick actions) so the
 * upload/validation/dedup logic exists exactly once. A controlled component:
 * the caller owns `value` and folds it into the same PUT that sets
 * `status: "on_hold"` when the user confirms.
 */
export function HoldImagesField({
	caseId,
	clientId,
	value,
	onChange,
	onUploadingChange,
	theme = "light",
}: {
	caseId: string;
	clientId: string;
	value: PendingHoldImage[];
	onChange: (next: PendingHoldImage[]) => void;
	onUploadingChange?: (uploading: boolean) => void;
	/** Matches the embedding dialog's own styling — "dark" for the ops portal's
	 * solid `bg-primary` quick-action dialog, "light" everywhere else. */
	theme?: "light" | "dark";
}) {
	const dark = theme === "dark";
	const [isUploading, setIsUploading] = useState(false);
	const [progress, setProgress] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Already-attached images on this case, for the 5-image cap and duplicate
	// detection — same cache key CaseDetailView's preview button/carousel use,
	// so no extra network round-trip when both are mounted.
	const { data: existingResponse } = useQuery<{ data: ExistingHoldFile[] }>({
		queryKey: ["case-hold-files", caseId],
		queryFn: async () => {
			const res = await fetch(`/api/cases/${caseId}/hold-files`);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || "Failed to fetch hold images");
			}
			return res.json();
		},
		retry: false,
		staleTime: 30_000,
	});
	const existing = existingResponse?.data || [];

	const setUploading = (uploading: boolean) => {
		setIsUploading(uploading);
		onUploadingChange?.(uploading);
	};

	const handleSelect = async (files: File[]) => {
		const remainingSlots = MAX_HOLD_IMAGES - existing.length - value.length;
		if (remainingSlots <= 0) {
			toast.error(`You can attach at most ${MAX_HOLD_IMAGES} hold images.`);
			return;
		}

		const candidates = files.slice(0, remainingSlots);
		if (files.length > remainingSlots) {
			toast.warning(`Only ${remainingSlots} more hold image(s) can be added (max ${MAX_HOLD_IMAGES}).`);
		}

		const isDuplicate = (name: string, size: number) =>
			existing.some((f) => f.fileName === name && f.fileSize === size) ||
			value.some((f) => f.fileName === name && f.fileSize === size);

		const validFiles: File[] = [];
		for (const file of candidates) {
			if (!HOLD_IMAGE_MIME_TYPES.has(file.type)) {
				toast.warning(`Skipped "${file.name}": only JPG, PNG or WEBP images are supported (no HEIC/SVG).`);
				continue;
			}
			if (file.size > MAX_HOLD_IMAGE_SIZE) {
				toast.warning(`Skipped "${file.name}": exceeds the 15MB limit for hold images.`);
				continue;
			}
			if (isDuplicate(file.name, file.size)) {
				toast.warning(`"${file.name}" is already attached to this case's hold record.`);
				continue;
			}
			validFiles.push(file);
		}

		if (validFiles.length === 0) return;

		setUploading(true);
		setProgress(0);

		const uploaded: PendingHoldImage[] = [];
		try {
			for (let i = 0; i < validFiles.length; i++) {
				const file = validFiles[i];
				// Lab- and case-scoped storage key (hold_images-plan.md §4.10/§5):
				// `${labName}/hold-images/${caseId}/${uuid}-${originalName}` — no
				// two cases can ever collide on the same R2 object. The display
				// `fileName` sent below stays the clean original name.
				const storageFile = new File(
					[file],
					`hold-images/${caseId}/${crypto.randomUUID()}-${file.name}`,
					{ type: file.type },
				);
				const onFileProgress = (pct: number) => {
					const baseProgress = (i / validFiles.length) * 100;
					const fileContribution = (pct / 100) * (100 / validFiles.length);
					setProgress(Math.round(baseProgress + fileContribution));
				};

				await new Promise<void>((resolve, reject) => {
					uploadFileInChunks(
						storageFile,
						{ clientId },
						onFileProgress,
						(res) => {
							uploaded.push({
								fileUrl: res.fileUrl,
								fileName: file.name,
								fileType: file.type,
								fileSize: file.size,
							});
							resolve();
						},
						(err) => reject(new Error(`Failed to upload ${file.name}: ${err}`)),
					);
				});
			}

			onChange([...value, ...uploaded]);
			toast.success(`Attached ${uploaded.length} hold image(s) — click Confirm to save.`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to upload one or more hold images.");
		} finally {
			setUploading(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	const handleRemove = (index: number) => {
		onChange(value.filter((_, i) => i !== index));
	};

	return (
		<div className="space-y-2">
			<Label className={`text-xs font-bold ${dark ? "text-zinc-200" : "text-gray-700"}`}>
				Hold Images (optional)
				{value.length > 0 && ` — ${value.length}/${MAX_HOLD_IMAGES}`}
			</Label>
			<input
				ref={inputRef}
				type="file"
				accept="image/jpeg,image/png,image/webp"
				multiple
				className="hidden"
				onChange={(e) => {
					const files = Array.from(e.target.files || []);
					e.target.value = "";
					if (files.length > 0) void handleSelect(files);
				}}
			/>
			{value.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{value.map((img, idx) => (
						<div
							key={`${img.fileUrl}-${idx}`}
							className={`relative w-16 h-16 rounded-md overflow-hidden border group ${dark ? "border-zinc-700" : "border-gray-300"}`}
						>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={img.fileUrl} alt={img.fileName} className="w-full h-full object-cover" />
							<button
								type="button"
								onClick={() => handleRemove(idx)}
								className="absolute top-0.5 right-0.5 bg-black/60 hover:bg-black/80 text-white rounded-full p-0.5"
							>
								<Trash2 className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
			)}
			{isUploading ? (
				<p className={`text-xs font-medium ${dark ? "text-zinc-300" : "text-gray-600"}`}>
					Uploading... {progress}%
				</p>
			) : value.length + existing.length < MAX_HOLD_IMAGES ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					className={`h-8 text-xs gap-1.5 ${dark ? "bg-primary/80 border-primary-50/50 text-white hover:bg-primary/60 hover:text-white" : ""}`}
					onClick={() => inputRef.current?.click()}
				>
					<Upload className="h-3.5 w-3.5" /> Add Images
				</Button>
			) : (
				<p className={`text-[11px] ${dark ? "text-zinc-400" : "text-gray-500"}`}>
					Maximum of {MAX_HOLD_IMAGES} hold images reached.
				</p>
			)}
			<p className={`text-[11px] ${dark ? "text-zinc-400" : "text-gray-500"}`}>
				JPG, PNG or WEBP, up to 15MB each.
			</p>
		</div>
	);
}
