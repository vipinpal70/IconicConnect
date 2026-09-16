/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { StatusBadge } from "@/src/components/StatusBadge";
import { ToothChart } from "@/src/components/ToothChart";
import { ThreeShapeImport } from "@/src/components/ThreeShapeImport/ThreeShapeImport";
import { type CaseStatus } from "@/src/data/demoData";
import {
	Plus,
	Search,
	Download,
	Upload,
	X,
	FileArchive,
	RefreshCw,
	MessageSquare,
	Loader2,
	PauseCircle,
} from "lucide-react";
import { downloadCSV, extractCaseTeethInfo } from "@/src/lib/export-csv";
import { useRouter } from "next/navigation";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/src/components/ui/dialog";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/src/components/ui/tabs";
import { Label } from "@/src/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
import { toast } from "sonner";
import { uploadFileInChunks } from "@/src/lib/upload-utils";
import { HOLD_REASONS } from "@/src/lib/case-utils";

const HOLDABLE_STATUSES = [
	"scan_received",
	"scan_not_verified",
	"scan_verified",
];

interface BulkRow {
	fileName: string;
	file: File;
	category: string;
	subTypeData: Record<string, any>;
	modelRequired: "yes" | "no" | null;
	teeth: number[];
	toothSystem: "USA" | "FDI";
	notes: string;
	uploadProgress: number;
	uploadedUrl: string | null;
	isUploading: boolean;
	caseId: string;
	uploadedFile?: {
		fileUrl: string;
		fileName: string;
		fileSize: number;
		fileType: string;
	};
}

const uploadFileWithXHR = async (
	file: File,
	labName: string,
	onProgress: (progress: number) => void,
	onSuccess: (res: {
		fileUrl: string;
		fileName: string;
		fileSize: number;
		fileType: string;
	}) => void,
	onError: (err: string) => void,
) => {
	await uploadFileInChunks(file, {}, onProgress, onSuccess, onError);
};

const validateFile = (file: File): { isValid: boolean; error?: string } => {
	const maxLimit = 5 * 1024 * 1024 * 1024; // 5GB
	if (file.size > maxLimit) {
		return {
			isValid: false,
			error: `File size exceeds the 5GB limit. Size: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
		};
	}

	const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
	const allowedExtensions = [
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
		".mp4",
		".mkv",
		".avi",
		".mov",
		".webm",
		".wmv",
		".flv",
		".3gp",
		".mpeg",
		".mpg",
		".pdf",
		".zip",
		".doc",
		".docx",
		".txt",
		".html",
		".htm",
	];

	if (!allowedExtensions.includes(ext)) {
		return { isValid: false, error: `File type "${ext}" is not supported.` };
	}

	return { isValid: true };
};

const validateTeethLibraryFile = (
	file: File,
): { isValid: boolean; error?: string } => {
	const maxLimit = 5 * 1024 * 1024 * 1024; // 5GB
	if (file.size > maxLimit) {
		return {
			isValid: false,
			error: `Teeth library file size exceeds the 5GB limit. Size: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
		};
	}

	const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
	const allowedExtensions = [".dme", ".zip"];

	if (!allowedExtensions.includes(ext)) {
		return {
			isValid: false,
			error: `File type "${ext}" is not supported. Only .dme or .zip files are allowed for custom teeth libraries.`,
		};
	}

	return { isValid: true };
};

const statusFilters: (CaseStatus | "All")[] = [
	"All",
	"Submitted",
	"In Validation",
	"In Design",
	"Internal QC",
	"Pending Client Approval",
	"Feedback",
	"On Hold",
	"Completed",
	"Cancelled",
];

const STATUS_FILTER_MAP: Record<string, string[]> = {
	Submitted: ["scan_received"],
	"In Validation": ["scan_verified", "scan_not_verified"],
	"In Design": ["allocated_to_designer", "in_progress"],
	"Internal QC": ["internal_qc"],
	"Pending Client Approval": ["submitted_to_client", "change_requested"],
	Feedback: ["client_feedback"],
	"On Hold": ["on_hold"],
	Completed: ["approved", "delivered"],
	Cancelled: ["cancelled"],
};

// Only Category, a Case File, and a Tooth Selection are required to submit —
// every category sub-type field (incl. the Implant Crown & Bridge attachment
// and its teeth) is optional, enforced client- and server-side.
const hasAllRequiredCaseFields = (
	category: string,
	subTypeData: Record<string, any>,
	notes: string,
	teeth: number[],
	uploadedFile: unknown,
	crownBridgeTeeth?: number[],
	modelRequired?: "yes" | "no" | null,
) => {
	const fields =
		CASE_HIERARCHY[category as keyof typeof CASE_HIERARCHY]?.fields || [];
	const allDynamicFieldsSelected = fields.every(
		(field: any) => field.optional || Boolean(subTypeData[field.name]),
	);
	return Boolean(
		category &&
		uploadedFile &&
		allDynamicFieldsSelected &&
		teeth.length > 0 &&
		(modelRequired === "yes" || modelRequired === "no"),
	);
};

// Category, the primary Case Type (caseType / caseType1), a Case File, and a
// Tooth Selection are required to submit. Every secondary field (Arch,
// Occlusion, the Implant Crown & Bridge attachment) is optional — still
// rendered, but doesn't block submission when left blank.
const CASE_HIERARCHY = {
	"Crown & Bridges": {
		fields: [
			{
				name: "caseType",
				label: "Case Type",
				type: "select",
				options: [
					"Crown",
					"Bridge",
					"Cutback",
					"Coping",
					"Screw Retained",
					"In-Lay",
					"On-Lay",
				],
			},
		],
	},
	Denture: {
		fields: [
			{
				name: "caseType1",
				label: "Case Type 1",
				type: "select",
				options: [
					"Reference Denture",
					"Copy Denture",
					"Immediate Denture",
					"Full Denture",
					"Partial Denture",
				],
			},
			{
				name: "caseType2",
				label: "Case Type 2",
				type: "select",
				options: ["Lower", "Upper", "Both Arches"],
				optional: true,
			},
		],
	},
	Cosmetics: {
		fields: [
			{
				name: "caseType",
				label: "Case Type",
				type: "select",
				options: ["Digital Wax Up", "Vineers", "Snap on Smile"],
			},
		],
	},
	Appliances: {
		fields: [
			{
				name: "caseType1",
				label: "Case Type 1",
				type: "select",
				options: ["Night Guards", "Sports Guard", "Mouth Guard", "NTI"],
			},
			{
				name: "occlusion",
				label: "Occlusion",
				type: "select",
				options: ["even occlusion", "custom"],
				optional: true,
			},
			{
				name: "arch",
				label: "Arch",
				type: "select",
				options: ["Lower", "Upper"],
				optional: true,
			},
		],
	},
	Implant: {
		fields: [
			{
				name: "caseType1",
				label: "Sub Type 1",
				type: "select",
				options: ["Robotic", "Custom", "Ti-Base"],
			},
			{
				name: "caseType2",
				label: "Crown & Bridge type",
				type: "select",
				options: ["None", "Crown", "Bridge"],
				optional: true,
			},
		],
	},
};

export default function CasesPage() {
	const router = useRouter();
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<CaseStatus | "All">("All");
	const [typeFilter, setTypeFilter] = useState<string | "All">("All");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [uploadOpen, setUploadOpen] = useState(false);

	const [cases, setCases] = useState<any[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [hasMore, setHasMore] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const pageLimitRef = useRef(10);

	const [holdCaseId, setHoldCaseId] = useState<string | null>(null);
	const [holdReasonSelect, setHoldReasonSelect] = useState("");
	const [holdCustomReason, setHoldCustomReason] = useState("");
	const [isHoldSubmitting, setIsHoldSubmitting] = useState(false);

	const fetchCases = async (showLoading = true) => {
		if (showLoading) setIsLoading(true);
		try {
			const res = await fetch(
				`/api/cases?limit=${pageLimitRef.current}&page=1`,
			);
			if (res.ok) {
				const json = await res.json();
				setCases(Array.isArray(json.data) ? json.data : []);
				setHasMore(json.hasMore ?? false);
			} else {
				toast.error("Failed to load cases");
			}
		} catch (err) {
			console.error("Error fetching cases:", err);
			toast.error("Failed to fetch cases");
		} finally {
			if (showLoading) setIsLoading(false);
		}
	};

	const openHoldDialog = (caseId: string) => {
		setHoldCaseId(caseId);
		setHoldReasonSelect("");
		setHoldCustomReason("");
	};

	const handleConfirmHold = async () => {
		if (!holdCaseId) return;
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

		setIsHoldSubmitting(true);
		try {
			const res = await fetch(`/api/cases/${holdCaseId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "on_hold", holdReason: finalReason }),
			});
			if (res.ok) {
				toast.success("Case put on hold.");
				setHoldCaseId(null);
				fetchCases(false);
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.error || "Failed to put case on hold");
			}
		} catch {
			toast.error("Failed to put case on hold");
		} finally {
			setIsHoldSubmitting(false);
		}
	};

	const handleLoadMore = async () => {
		pageLimitRef.current += 10;
		setIsLoadingMore(true);
		try {
			const res = await fetch(
				`/api/cases?limit=${pageLimitRef.current}&page=1`,
			);
			if (res.ok) {
				const json = await res.json();
				setCases(Array.isArray(json.data) ? json.data : []);
				setHasMore(json.hasMore ?? false);
			} else {
				pageLimitRef.current -= 10;
				toast.error("Failed to load more cases");
			}
		} catch {
			pageLimitRef.current -= 10;
			toast.error("Failed to load more cases");
		} finally {
			setIsLoadingMore(false);
		}
	};

	useEffect(() => {
		pageLimitRef.current = 10;
		const timeoutId = window.setTimeout(() => {
			void fetchCases();
		}, 0);
		const intervalId = window.setInterval(() => {
			void fetchCases(false);
		}, 30_000);
		return () => {
			window.clearTimeout(timeoutId);
			window.clearInterval(intervalId);
		};
	}, []);

	const [category, setCategory] = useState<string>("Crown & Bridges");
	const [subTypeData, setSubTypeData] = useState<Record<string, any>>({});
	// No default — the lab must actively pick Yes/No; see handleSubmit's guard.
	const [modelRequired, setModelRequired] = useState<"yes" | "no" | null>(null);
	const [teeth, setTeeth] = useState<number[]>([]);
	const [crownBridgeTeeth, setCrownBridgeTeeth] = useState<number[]>([]);
	const [toothSystem, setToothSystem] = useState<"USA" | "FDI">("USA");
	const [notes, setNotes] = useState("");
	const [singleFile, setSingleFile] = useState<File | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState(0);
	const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
	const [uploadedFile, setUploadedFile] = useState<{
		fileUrl: string;
		fileName: string;
		fileSize: number;
		fileType: string;
	} | null>(null);
	const [labName, setLabName] = useState<string>("Client");

	// Reference Images State (optional, up to 5)
	const [referenceImages, setReferenceImages] = useState<
		Array<{ fileUrl: string; fileName: string; fileSize: number; fileType: string }>
	>([]);
	const [isUploadingReferenceImages, setIsUploadingReferenceImages] = useState(false);
	const [referenceImagesUploadProgress, setReferenceImagesUploadProgress] = useState(0);
	const referenceImagesRef = useRef<HTMLInputElement>(null);
	const MAX_REFERENCE_IMAGES = 5;

	const [preferredTeethLibrary, setPreferredTeethLibrary] =
		useState<string>("default");
	const [isLibraryUploading, setIsLibraryUploading] = useState(false);
	const [libraryUploadProgress, setLibraryUploadProgress] = useState(0);
	const [uploadedLibraryFile, setUploadedLibraryFile] = useState<{
		fileUrl: string;
		fileName: string;
		fileSize: number;
		fileType: string;
	} | null>(null);
	const libraryFileRef = useRef<HTMLInputElement>(null);

	// Refs for replacement triggering
	const singleFileRef = useRef<HTMLInputElement>(null);
	const bulkRowFileRef = useRef<HTMLInputElement>(null);
	const [replacingBulkRowIndex, setReplacingBulkRowIndex] = useState<
		number | null
	>(null);

	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitCooldown, setSubmitCooldown] = useState(false);
	const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
	// Synchronous re-entrancy locks for handleSubmit/handleBulkSubmit — a plain
	// ref, not state. A fast double-click can fire the handler twice before a
	// setState-based guard (isSubmitting/submitCooldown) has actually re-rendered
	// and disabled the button, sending two requests and showing two error toasts
	// for one logical submit. Checked+set synchronously as the very first thing
	// in each handler, so the second call is blocked immediately regardless of
	// React's state-update timing.
	const isSubmittingLockRef = useRef(false);
	const isBulkSubmittingLockRef = useRef(false);

	useEffect(() => {
		return () => {
			if (cooldownTimerRef.current) {
				clearTimeout(cooldownTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!uploadOpen) {
			setIsSubmitting(false);
			setSubmitCooldown(false);
			if (cooldownTimerRef.current) {
				clearTimeout(cooldownTimerRef.current);
				cooldownTimerRef.current = null;
			}
		}
	}, [uploadOpen]);

	// Bulk upload
	const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
	const bulkFileRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		async function fetchProfile() {
			const supabase = createClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();
			if (user) {
				const { data: profile } = await supabase
					.from("profiles")
					.select("labName")
					.eq("id", user.id)
					.single();
				if (profile?.labName) setLabName(profile.labName);
			}
		}
		fetchProfile();
	}, []);

	const handleDeleteUploadedFile = async (fileName: string) => {
		try {
			await fetch(
				`/api/cases/files?labName=${encodeURIComponent(labName)}&fileName=${encodeURIComponent(fileName)}`,
				{
					method: "DELETE",
				},
			);
		} catch (e) {
			console.error("Failed to delete local case file:", e);
		}
	};

	const handleFileSelect = async (file: File) => {
		const check = validateFile(file);
		if (!check.isValid) {
			window.alert(check.error);
			return;
		}

		setSingleFile(file);
		setIsUploading(true);
		setUploadProgress(0);

		uploadFileWithXHR(
			file,
			labName,
			(progress) => {
				setUploadProgress(progress);
			},
			(res) => {
				setUploadProgress(100);
				setUploadedFileUrl(res.fileUrl);
				setUploadedFile(res);
				setTimeout(() => setIsUploading(false), 500);
			},
			(err) => {
				console.error("Immediate upload error:", err);
				setIsUploading(false);
				setUploadProgress(0);
			},
		);
	};

	const handleReferenceImagesSelect = async (files: File[]) => {
		const remainingSlots = MAX_REFERENCE_IMAGES - referenceImages.length;
		if (remainingSlots <= 0) {
			toast.error(`You can attach at most ${MAX_REFERENCE_IMAGES} reference images.`);
			return;
		}

		const candidates = files.slice(0, remainingSlots);
		if (files.length > remainingSlots) {
			toast.warning(
				`Only ${remainingSlots} more reference image(s) can be added (max ${MAX_REFERENCE_IMAGES}).`,
			);
		}

		const validFiles: File[] = [];
		for (const file of candidates) {
			if (!file.type.startsWith("image/")) {
				toast.warning(`Skipped "${file.name}": only image files are allowed.`);
				continue;
			}
			const check = validateFile(file);
			if (!check.isValid) {
				toast.warning(`Skipped "${file.name}": ${check.error}`);
				continue;
			}
			validFiles.push(file);
		}

		if (validFiles.length === 0) return;

		setIsUploadingReferenceImages(true);
		setReferenceImagesUploadProgress(0);

		const uploadedResults: Array<{ fileUrl: string; fileName: string; fileSize: number; fileType: string }> = [];

		try {
			for (let i = 0; i < validFiles.length; i++) {
				const file = validFiles[i];
				const onFileProgress = (pct: number) => {
					const baseProgress = (i / validFiles.length) * 100;
					const fileContribution = (pct / 100) * (100 / validFiles.length);
					setReferenceImagesUploadProgress(Math.round(baseProgress + fileContribution));
				};

				await new Promise<void>((resolve, reject) => {
					uploadFileWithXHR(
						file,
						labName,
						onFileProgress,
						(res) => {
							uploadedResults.push(res);
							resolve();
						},
						(err) => reject(new Error(`Failed to upload ${file.name}: ${err}`)),
					);
				});
			}

			setReferenceImages((prev) => [...prev, ...uploadedResults]);
			toast.success(`Attached ${validFiles.length} reference image(s).`);
		} catch (err: any) {
			toast.error(err.message || "Failed to upload one or more reference images.");
		} finally {
			setIsUploadingReferenceImages(false);
			if (referenceImagesRef.current) referenceImagesRef.current.value = "";
		}
	};

	const handleLibraryFileSelect = async (file: File) => {
		const check = validateTeethLibraryFile(file);
		if (!check.isValid) {
			window.alert(check.error);
			return;
		}

		setIsLibraryUploading(true);
		setLibraryUploadProgress(0);

		uploadFileWithXHR(
			file,
			labName,
			(progress) => {
				setLibraryUploadProgress(progress);
			},
			(res) => {
				setLibraryUploadProgress(100);
				setUploadedLibraryFile(res);
				setTimeout(() => setIsLibraryUploading(false), 500);
			},
			(err) => {
				console.error("Library upload error:", err);
				setIsLibraryUploading(false);
				setLibraryUploadProgress(0);
			},
		);
	};

	const handleSingleFileReplace = async (file: File) => {
		const check = validateFile(file);
		if (!check.isValid) {
			window.alert(check.error);
			return;
		}

		// Clean up old file if it exists
		if (uploadedFile) {
			await handleDeleteUploadedFile(uploadedFile.fileName);
		}

		// Upload the new one
		handleFileSelect(file);
	};

	const handleBulkRowFileReplace = async (index: number, file: File) => {
		const check = validateFile(file);
		if (!check.isValid) {
			window.alert(`File "${file.name}": ${check.error}`);
			return;
		}

		const row = bulkRows[index];
		if (!row) return;

		// Clean up old file if it exists
		if (row.uploadedFile) {
			await handleDeleteUploadedFile(row.uploadedFile.fileName);
		}

		// Set row to uploading state in the UI
		updateBulkRow(index, {
			fileName: file.name,
			file: file,
			uploadProgress: 0,
			uploadedUrl: null,
			uploadedFile: undefined,
			isUploading: true,
		});

		uploadFileWithXHR(
			file,
			labName,
			(progress) => {
				updateBulkRow(index, { uploadProgress: progress });
			},
			(res) => {
				updateBulkRow(index, {
					uploadProgress: 100,
					isUploading: false,
					uploadedUrl: res.fileUrl,
					uploadedFile: res,
				});
			},
			(err) => {
				console.error(`Immediate bulk upload error for ${file.name}:`, err);
				updateBulkRow(index, { isUploading: false, uploadProgress: 0 });
			},
		);
	};

	const filtered = useMemo(() => {
		return cases.filter((c) => {
			const s = search.toLowerCase();
			const friendlyId = (c.caseNumber || c.id || "").toLowerCase();
			const friendlyRestoration = (
				c.subTypeData
					? Object.entries(c.subTypeData)
							.filter(
								([k, v]) =>
									k !== "teeth" &&
									k !== "crownBridgeTeeth" &&
									k !== "toothSystem" &&
									k !== "notes" &&
									k !== "modelRequired" &&
									typeof v === "string" &&
									v &&
									v.toLowerCase() !== "none",
							)
							.map(([_, v]) => v)
							.join(" - ")
					: c.category || ""
			).toLowerCase();

			const friendlyCaseName = (c.scanFileName || "").toLowerCase();

			const matchesSearch =
				!s ||
				friendlyId.includes(s) ||
				friendlyRestoration.includes(s) ||
				friendlyCaseName.includes(s);

			const matchesStatus =
				statusFilter === "All" ||
				(STATUS_FILTER_MAP[statusFilter]?.includes(c.status) ?? false);

			const matchesType = typeFilter === "All" || c.category === typeFilter;

			const createdAtDate = c.createdAt
				? new Date(c.createdAt).toISOString().split("T")[0]
				: "";
			const matchesFrom = !from || createdAtDate >= from;
			const matchesTo = !to || createdAtDate <= to;

			return (
				matchesSearch &&
				matchesStatus &&
				matchesType &&
				matchesFrom &&
				matchesTo
			);
		});
	}, [cases, search, statusFilter, typeFilter, from, to]);

	const handleSubmit = async () => {
		if (isSubmittingLockRef.current || submitCooldown || isSubmitting) return;

		if (
			!hasAllRequiredCaseFields(
				category,
				subTypeData,
				notes,
				teeth,
				uploadedFile,
				crownBridgeTeeth,
				modelRequired,
			)
		) {
			toast.error(
				"Please select a category and case type, choose teeth, upload a file, and specify whether a model is required.",
			);
			return;
		}

		if (preferredTeethLibrary === "other" && !uploadedLibraryFile) {
			toast.error("Please upload your custom teeth library file.");
			return;
		}

		isSubmittingLockRef.current = true;
		setIsSubmitting(true);
		setSubmitCooldown(true);
		if (cooldownTimerRef.current) {
			clearTimeout(cooldownTimerRef.current);
		}
		cooldownTimerRef.current = setTimeout(() => {
			setSubmitCooldown(false);
		}, 5000);

		const formData = new FormData();
		const caseData = {
			category,
			subTypeData: {
				...subTypeData,
				modelRequired,
				teeth,
				toothSystem,
				notes,
				...(category === "Implant" && subTypeData.caseType2 !== "None"
					? { crownBridgeTeeth }
					: {}),
			},
			uploadedFile,
			referenceImages,
			preferredTeethLibrary,
			teethLibraryFileUrl: uploadedLibraryFile?.fileUrl || null,
			teethLibraryFileName: uploadedLibraryFile?.fileName || null,
		};

		formData.append("cases", JSON.stringify(caseData));

		try {
			const res = await fetch("/api/cases", {
				method: "POST",
				body: formData,
			});

			if (res.ok) {
				toast.success("Case submitted successfully!");
				setUploadOpen(false);
				setNotes("");
				setTeeth([]);
				setCrownBridgeTeeth([]);
				setModelRequired(null);
				setCategory("Crown & Bridges");
				setSubTypeData({});
				setSingleFile(null);
				setUploadedFileUrl(null);
				setUploadedFile(null);
				setReferenceImages([]);
				setPreferredTeethLibrary("default");
				setUploadedLibraryFile(null);
				pageLimitRef.current += 1;
				fetchCases();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.error || "Failed to submit case.");
				console.error("Failed to submit single case");
			}
		} catch (error) {
			toast.error("An error occurred during submission.");
			console.error("Single submit error:", error);
		} finally {
			isSubmittingLockRef.current = false;
			setIsSubmitting(false);
		}
	};

	const onBulkFiles = (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const pickedFiles = Array.from(files).slice(0, 10);

		// Validate all picked files first
		for (const f of pickedFiles) {
			const check = validateFile(f);
			if (!check.isValid) {
				window.alert(`File "${f.name}": ${check.error}`);
				return;
			}
		}

		// First, set the rows with uploading status
		const rows: BulkRow[] = pickedFiles.map((f) => {
			const caseId = crypto.randomUUID();
			return {
				fileName: f.name,
				file: f,
				category: "Crown & Bridges",
				subTypeData: {},
				modelRequired: null,
				teeth: [],
				toothSystem: "USA",
				notes: "",
				uploadProgress: 0,
				uploadedUrl: null,
				isUploading: true,
				caseId,
			};
		});

		setBulkRows(rows);

		// Then start uploads immediately
		rows.forEach((row) => {
			uploadFileWithXHR(
				row.file,
				labName,
				(progress) => {
					setBulkRows((prev) =>
						prev.map((r) =>
							r.caseId === row.caseId ? { ...r, uploadProgress: progress } : r,
						),
					);
				},
				(res) => {
					setBulkRows((prev) =>
						prev.map((r) =>
							r.caseId === row.caseId
								? {
										...r,
										uploadProgress: 100,
										isUploading: false,
										uploadedUrl: res.fileUrl,
										uploadedFile: res,
									}
								: r,
						),
					);
				},
				(err) => {
					console.error(
						`Immediate bulk upload error for ${row.fileName}:`,
						err,
					);
					setBulkRows((prev) =>
						prev.map((r) =>
							r.caseId === row.caseId
								? { ...r, isUploading: false, uploadProgress: 0 }
								: r,
						),
					);
				},
			);
		});
	};

	const updateBulkRow = (i: number, patch: Partial<BulkRow>) =>
		setBulkRows((prev) =>
			prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
		);

	const removeBulkRow = (i: number) =>
		setBulkRows((prev) => prev.filter((_, idx) => idx !== i));

	const handleBulkSubmit = async () => {
		if (isBulkSubmittingLockRef.current || submitCooldown || isSubmitting) return;

		if (bulkRows.length === 0) return;

		const hasInvalidRow = bulkRows.some(
			(row) =>
				!hasAllRequiredCaseFields(
					row.category,
					row.subTypeData,
					row.notes,
					row.teeth,
					row.uploadedFile,
					undefined,
					row.modelRequired,
				),
		);
		if (hasInvalidRow) {
			toast.error(
				"Complete category, case type, teeth selection, file upload, and the Model Required choice for every case.",
			);
			return;
		}

		isBulkSubmittingLockRef.current = true;
		setIsSubmitting(true);
		setSubmitCooldown(true);
		if (cooldownTimerRef.current) {
			clearTimeout(cooldownTimerRef.current);
		}
		cooldownTimerRef.current = setTimeout(() => {
			setSubmitCooldown(false);
		}, 5000);

		const formData = new FormData();

		const casesData = bulkRows.map((row) => ({
			category: row.category,
			subTypeData: {
				...row.subTypeData,
				modelRequired: row.modelRequired,
				teeth: row.teeth,
				toothSystem: row.toothSystem,
				notes: row.notes,
			},
			uploadedFile: row.uploadedFile,
		}));

		formData.append("cases", JSON.stringify(casesData));

		try {
			const res = await fetch("/api/cases", {
				method: "POST",
				body: formData,
			});

			if (res.ok) {
				toast.success("Cases submitted successfully!");
				const addedCount = bulkRows.length;
				setBulkRows([]);
				if (bulkFileRef.current) bulkFileRef.current.value = "";
				setUploadOpen(false);
				pageLimitRef.current += addedCount;
				fetchCases();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.error || "Failed to submit bulk cases.");
				console.error("Failed to submit bulk cases");
			}
		} catch (error) {
			toast.error("An error occurred during submission.");
			console.error("Bulk submit error:", error);
		} finally {
			isBulkSubmittingLockRef.current = false;
			setIsSubmitting(false);
		}
	};

	// Helper function to remove the extension from file name
	const removeExtensionFromString = (str: string) => {
		if (str.lastIndexOf(".") > 0) {
			return str.substring(0, str.lastIndexOf("."));
		}
		return str;
	};

	return (
		<div className="space-y-4 animate-fade-in">
			<div className="flex items-center justify-between flex-wrap gap-3">
				<div>
					<h1 className="text-xl font-semibold text-foreground">Cases</h1>
					<p className="text-xs text-muted-foreground mt-0.5">
						{filtered.length} shown · {cases.length} loaded
						{hasMore ? " · more available" : ""}
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						className="h-8 text-xs gap-1.5"
						onClick={() => {
							const headers = [
								"Case Name",
								"Case #",
								"Category",
								"Type / Restoration",
								"Teeth / Arch Selection",
								"Unit Count",
								"Numbering System",
								"Status",
								"Due Date",
								"Created At",
							];
							const rows = filtered.map((c) => {
								const restoration = c.subTypeData
									? Object.entries(c.subTypeData)
											.filter(
												([k, v]) =>
													k !== "teeth" &&
													k !== "crownBridgeTeeth" &&
													k !== "toothSystem" &&
													k !== "notes" &&
													k !== "modelRequired" &&
													typeof v === "string" &&
													v &&
													v.toLowerCase() !== "none",
											)
											.map(([, v]) => v as string)
											.join(" - ") || "—"
									: "—";
								const teeth = extractCaseTeethInfo(
									c.category,
									c.subTypeData as Record<string, unknown>,
								);
								return [
									c.scanFileName || "—",
									c.caseNumber || "—",
									c.category || "—",
									restoration,
									teeth.selection,
									teeth.unitCount,
									teeth.numberingSystem,
									c.status,
									c.dueDate
										? new Date(c.dueDate).toLocaleDateString("en-IN")
										: "—",
									c.createdAt
										? new Date(c.createdAt).toLocaleDateString("en-IN")
										: "—",
								];
							});
							const date = new Date().toISOString().split("T")[0];
							downloadCSV(headers, rows, `my-cases-${date}.csv`);
						}}
					>
						<Download className="h-3.5 w-3.5" /> Export
					</Button>
					<Dialog
						open={uploadOpen}
						onOpenChange={(val) => {
							if (isSubmitting || isUploading || isLibraryUploading) return;
							setUploadOpen(val);
						}}
					>
						<DialogTrigger asChild>
							<Button size="sm" className="h-8 text-xs">
								<Plus className="h-3.5 w-3.5 mr-1.5" />
								Add New Case
							</Button>
						</DialogTrigger>
						<DialogContent
							className="sm:max-w-3xl"
							style={{ maxHeight: "85vh", overflowY: "auto" }}
							onPointerDownOutside={(e) => {
								if (isSubmitting || isUploading || isLibraryUploading)
									e.preventDefault();
							}}
							onEscapeKeyDown={(e) => {
								if (isSubmitting || isUploading || isLibraryUploading)
									e.preventDefault();
							}}
						>
							<DialogHeader>
								<DialogTitle>Submit New Case</DialogTitle>
							</DialogHeader>
							<Tabs defaultValue="single" className="mt-2">
								<TabsList className="grid w-full grid-cols-3">
									<TabsTrigger value="single">Single Case</TabsTrigger>
									<TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
									<TabsTrigger value="xml">3Shape Import</TabsTrigger>
								</TabsList>

								<TabsContent value="single" className="space-y-5 mt-4">
									{/* Drag and Drop / Fast Upload Area */}
									<div className="space-y-2">
										<Label>Case File</Label>
										<input
											ref={singleFileRef}
											type="file"
											className="hidden"
											onChange={(e) => {
												const file = e.target.files?.[0];
												if (file) handleSingleFileReplace(file);
											}}
										/>
										{isUploading ? (
											<div className="border-2 border-dashed rounded-lg p-6 text-center border-emerald-500 bg-emerald-50/10">
												<div className="space-y-2">
													<Upload className="h-6 w-6 mx-auto text-emerald-600 animate-pulse" />
													<p className="text-sm font-medium text-foreground">
														Uploading... {uploadProgress}%
													</p>
													<div className="w-full bg-muted rounded-full h-1.5 max-w-xs mx-auto">
														<div
															className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300"
															style={{ width: `${uploadProgress}%` }}
														></div>
													</div>
												</div>
											</div>
										) : uploadedFileUrl ? (
											<div className="flex items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg shadow-sm">
												<div className="flex items-center gap-3 min-w-0">
													<div className="p-2 bg-emerald-500/20 text-emerald-600 rounded-md shrink-0">
														<FileArchive className="h-5 w-5" />
													</div>
													<div className="min-w-0">
														<p className="text-sm font-semibold text-foreground truncate max-w-[280px] lg:max-w-[400px]">
															{singleFile?.name}
														</p>
														<div className="flex items-center gap-2 mt-0.5">
															<p className="text-xs text-muted-foreground">
																(
																{singleFile
																	? (singleFile.size / 1024 / 1024).toFixed(2)
																	: 0}{" "}
																MB)
															</p>
															<span className="inline-flex items-center text-[10px] font-bold text-emerald-600 px-1.5 py-0.5 bg-emerald-500/20 rounded">
																✓ Uploaded
															</span>
														</div>
													</div>
												</div>
												<div className="flex gap-2 shrink-0">
													<Button
														type="button"
														variant="outline"
														size="sm"
														onClick={(e) => {
															e.preventDefault();
															e.stopPropagation();
															singleFileRef.current?.click();
														}}
														className="h-9 text-xs flex items-center gap-1.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-600 hover:text-white bg-white font-medium"
													>
														<RefreshCw className="h-3.5 w-3.5" /> Replace File
													</Button>
													<Button
														type="button"
														variant="ghost"
														size="icon"
														onClick={async (e) => {
															e.preventDefault();
															e.stopPropagation();
															if (uploadedFile) {
																await handleDeleteUploadedFile(
																	uploadedFile.fileName,
																);
															}
															setSingleFile(null);
															setUploadedFileUrl(null);
															setUploadedFile(null);
														}}
														className="h-9 w-9 text-zinc-500 hover:text-red-500 hover:bg-red-50"
													>
														<X className="h-4 w-4" />
													</Button>
												</div>
											</div>
										) : (
											<label
												className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors block border-border hover:border-emerald-800"
												onDragOver={(e) => e.preventDefault()}
												onDrop={(e) => {
													e.preventDefault();
													const file = e.dataTransfer.files?.[0];
													if (file) handleFileSelect(file);
												}}
											>
												<input
													type="file"
													className="hidden"
													onChange={(e) => {
														const file = e.target.files?.[0];
														if (file) handleFileSelect(file);
													}}
												/>
												<div>
													<Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
													<p className="text-sm font-medium text-foreground">
														Drop file here or click to upload
													</p>
													<p className="text-xs text-muted-foreground mt-0.5">
														PNG, JPG, MP4, PDF, ZIP, DOC, DOCX, TXT (Max 2GB)
													</p>
												</div>
											</label>
										)}
									</div>

									{/* Reference Images (optional, up to 5) */}
									<div className="space-y-2">
										<Label>
											Reference Images (optional)
											{referenceImages.length > 0
												? ` — ${referenceImages.length}/${MAX_REFERENCE_IMAGES}`
												: ""}
										</Label>
										<input
											ref={referenceImagesRef}
											type="file"
											accept="image/*"
											multiple
											className="hidden"
											onChange={(e) => {
												const files = e.target.files ? Array.from(e.target.files) : [];
												if (files.length > 0) handleReferenceImagesSelect(files);
											}}
										/>
										{referenceImages.length > 0 && (
											<div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
												{referenceImages.map((img, idx) => (
													<div
														key={idx}
														className="relative group aspect-square rounded-md overflow-hidden border border-zinc-200 bg-zinc-50"
													>
														<img
															src={img.fileUrl}
															alt={img.fileName}
															className="w-full h-full object-cover"
														/>
														<button
															type="button"
															onClick={async (e) => {
																e.preventDefault();
																e.stopPropagation();
																await handleDeleteUploadedFile(img.fileName);
																setReferenceImages((prev) =>
																	prev.filter((_, i) => i !== idx),
																);
															}}
															className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
														>
															<X className="h-3 w-3" />
														</button>
													</div>
												))}
											</div>
										)}
										{isUploadingReferenceImages ? (
											<div className="border-2 border-dashed rounded-lg p-4 text-center border-emerald-500 bg-emerald-50/10">
												<p className="text-xs font-medium text-foreground">
													Uploading... {referenceImagesUploadProgress}%
												</p>
											</div>
										) : referenceImages.length < MAX_REFERENCE_IMAGES ? (
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => referenceImagesRef.current?.click()}
												className="h-8 text-xs flex items-center gap-1.5"
											>
												<Upload className="h-3 w-3" /> Add Reference Images
											</Button>
										) : null}
									</div>

									{category === "Implant" ? (
										<>
											<div className="space-y-2">
												<Label>Category</Label>
												<Select
													value={category}
													onValueChange={(v) => {
														setCategory(v);
														setSubTypeData(
															v === "Implant" ? { caseType2: "None" } : {},
														);
													}}
												>
													<SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
														<SelectValue />
													</SelectTrigger>
													<SelectContent className="bg-emerald-800 text-white">
														{Object.keys(CASE_HIERARCHY).map((cat) => (
															<SelectItem
																key={cat}
																value={cat}
																className="focus:bg-emerald-700 focus:text-white"
															>
																{cat}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>

											<div className="space-y-2">
												<Label>Sub Type 1</Label>
												<Select
													value={subTypeData["caseType1"] || ""}
													onValueChange={(v) =>
														setSubTypeData({ ...subTypeData, caseType1: v })
													}
												>
													<SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
														<SelectValue placeholder="Select Sub Type 1" />
													</SelectTrigger>
													<SelectContent className="bg-emerald-800 text-white">
														{CASE_HIERARCHY["Implant"].fields[0].options.map(
															(opt) => (
																<SelectItem
																	key={opt}
																	value={opt}
																	className="focus:bg-emerald-700 focus:text-white"
																>
																	{opt}
																</SelectItem>
															),
														)}
													</SelectContent>
												</Select>
											</div>

											<div className="space-y-2">
												<Label>
													Tooth Selection (
													{toothSystem === "USA"
														? "USA Universal Numbering"
														: "FDI Numbering System"}
													)
												</Label>
												<ToothChart
													selected={teeth}
													onChange={setTeeth}
													system={toothSystem}
													onChangeSystem={setToothSystem}
												/>
											</div>

											<div className="space-y-2">
												<Label>Model Required? *</Label>
												<RadioGroup
													value={modelRequired ?? undefined}
													onValueChange={(v) => setModelRequired(v as "yes" | "no")}
													className="flex gap-6 pt-2"
												>
													<div className="flex items-center gap-2">
														<RadioGroupItem value="yes" id="m-yes" />
														<Label htmlFor="m-yes" className="font-normal">
															Yes
														</Label>
													</div>
													<div className="flex items-center gap-2">
														<RadioGroupItem value="no" id="m-no" />
														<Label htmlFor="m-no" className="font-normal">
															No
														</Label>
													</div>
												</RadioGroup>
											</div>

											<div className="space-y-2">
												<Label>Preferred Teeth Library</Label>
												<Select
													value={preferredTeethLibrary}
													onValueChange={setPreferredTeethLibrary}
												>
													<SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
														<SelectValue placeholder="Select Preferred Teeth Library" />
													</SelectTrigger>
													<SelectContent className="bg-emerald-800 text-white">
														<SelectItem
															value="default"
															className="focus:bg-emerald-700 focus:text-white"
														>
															Default Teeth Library
														</SelectItem>
														<SelectItem
															value="other"
															className="focus:bg-emerald-700 focus:text-white"
														>
															Other Teeth Library
														</SelectItem>
													</SelectContent>
												</Select>
											</div>

											{preferredTeethLibrary === "other" && (
												<div className="space-y-2">
													<Label>
														Teeth Library File (.dme or .zip, max 2GB)
													</Label>
													<input
														ref={libraryFileRef}
														type="file"
														className="hidden"
														onChange={(e) => {
															const file = e.target.files?.[0];
															if (file) handleLibraryFileSelect(file);
														}}
													/>
													{isLibraryUploading ? (
														<div className="border-2 border-dashed rounded-lg p-6 text-center border-emerald-500 bg-emerald-50/10">
															<div className="space-y-2">
																<Upload className="h-6 w-6 mx-auto text-emerald-600 animate-pulse" />
																<p className="text-sm font-medium text-foreground">
																	Uploading Teeth Library...{" "}
																	{libraryUploadProgress}%
																</p>
																<div className="w-full bg-muted rounded-full h-1.5 max-w-xs mx-auto">
																	<div
																		className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300"
																		style={{
																			width: `${libraryUploadProgress}%`,
																		}}
																	></div>
																</div>
															</div>
														</div>
													) : uploadedLibraryFile ? (
														<div className="flex items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg shadow-sm">
															<div className="flex items-center gap-3 min-w-0">
																<div className="p-2 bg-emerald-500/20 text-emerald-600 rounded-md shrink-0">
																	<FileArchive className="h-5 w-5" />
																</div>
																<div className="min-w-0">
																	<p className="text-sm font-semibold text-foreground truncate max-w-[280px] lg:max-w-[400px]">
																		{uploadedLibraryFile.fileName}
																	</p>
																	<div className="flex items-center gap-2 mt-0.5">
																		<p className="text-xs text-muted-foreground">
																			(
																			{(
																				uploadedLibraryFile.fileSize /
																				1024 /
																				1024
																			).toFixed(2)}{" "}
																			MB)
																		</p>
																		<span className="inline-flex items-center text-[10px] font-bold text-emerald-600 px-1.5 py-0.5 bg-emerald-500/20 rounded">
																			✓ Uploaded
																		</span>
																	</div>
																</div>
															</div>
															<div className="flex gap-2 shrink-0">
																<Button
																	type="button"
																	variant="outline"
																	size="sm"
																	onClick={(e) => {
																		e.preventDefault();
																		e.stopPropagation();
																		libraryFileRef.current?.click();
																	}}
																	className="h-9 text-xs flex items-center gap-1.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-600 hover:text-white bg-white font-medium"
																>
																	<RefreshCw className="h-3.5 w-3.5" /> Replace
																</Button>
																<Button
																	type="button"
																	variant="ghost"
																	size="icon"
																	onClick={async (e) => {
																		e.preventDefault();
																		e.stopPropagation();
																		await handleDeleteUploadedFile(
																			uploadedLibraryFile.fileName,
																		);
																		setUploadedLibraryFile(null);
																	}}
																	className="h-9 w-9 text-zinc-500 hover:text-red-500 hover:bg-red-50"
																>
																	<X className="h-4 w-4" />
																</Button>
															</div>
														</div>
													) : (
														<label className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors block border-border hover:border-emerald-800">
															<input
																type="file"
																className="hidden"
																onChange={(e) => {
																	const file = e.target.files?.[0];
																	if (file) handleLibraryFileSelect(file);
																}}
															/>
															<div>
																<Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
																<p className="text-sm font-medium text-foreground">
																	Click to upload Custom Teeth Library
																</p>
																<p className="text-xs text-muted-foreground mt-0.5">
																	ZIP or DME (Max 2GB)
																</p>
															</div>
														</label>
													)}
												</div>
											)}

											<div className="space-y-2">
												<Label>Crown & Bridge type (optional)</Label>
												<Select
													value={subTypeData["caseType2"] || "None"}
													onValueChange={(v) => {
														setSubTypeData({ ...subTypeData, caseType2: v });
														if (v === "None") setCrownBridgeTeeth([]);
													}}
												>
													<SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
														<SelectValue placeholder="Select Crown & Bridge type" />
													</SelectTrigger>
													<SelectContent className="bg-emerald-800 text-white">
														{CASE_HIERARCHY["Implant"].fields[1].options.map(
															(opt) => (
																<SelectItem
																	key={opt}
																	value={opt}
																	className="focus:bg-emerald-700 focus:text-white"
																>
																	{opt}
																</SelectItem>
															),
														)}
													</SelectContent>
												</Select>
											</div>

											{subTypeData.caseType2 &&
												subTypeData.caseType2 !== "None" && (
													<div className="space-y-2">
														<Label>
															Teeth for Crown & Bridge Selection (
															{toothSystem === "USA"
																? "USA Universal Numbering"
																: "FDI Numbering System"}
															)
														</Label>
														<ToothChart
															selected={crownBridgeTeeth}
															onChange={setCrownBridgeTeeth}
															system={toothSystem}
															onChangeSystem={setToothSystem}
														/>
														{crownBridgeTeeth.length === 0 && (
															<p className="text-[11px] text-amber-600">
																Not required to submit, but the design team
																will need this — consider selecting the
																attachment teeth before sending.
															</p>
														)}
													</div>
												)}
										</>
									) : (
										<>
											<div className="grid grid-cols-2 gap-4">
												<div className="space-y-2">
													<Label>Category</Label>
													<Select
														value={category}
														onValueChange={(v) => {
															setCategory(v);
															setSubTypeData(
																v === "Implant" ? { caseType2: "None" } : {},
															);
														}}
													>
														<SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
															<SelectValue />
														</SelectTrigger>
														<SelectContent className="bg-emerald-800 text-white">
															{Object.keys(CASE_HIERARCHY).map((cat) => (
																<SelectItem
																	key={cat}
																	value={cat}
																	className="focus:bg-emerald-700 focus:text-white"
																>
																	{cat}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</div>
												<div className="space-y-2">
													<Label>Model Required? *</Label>
													<RadioGroup
														value={modelRequired ?? undefined}
														onValueChange={(v) => setModelRequired(v as "yes" | "no")}
														className="flex gap-6 pt-2"
													>
														<div className="flex items-center gap-2">
															<RadioGroupItem value="yes" id="m-yes" />
															<Label htmlFor="m-yes" className="font-normal">
																Yes
															</Label>
														</div>
														<div className="flex items-center gap-2">
															<RadioGroupItem value="no" id="m-no" />
															<Label htmlFor="m-no" className="font-normal">
																No
															</Label>
														</div>
													</RadioGroup>
												</div>
											</div>

											{/* Dynamic Fields */}
											{CASE_HIERARCHY[
												category as keyof typeof CASE_HIERARCHY
											]?.fields.map((field) => (
												<div className="space-y-2" key={field.name}>
													<Label>{field.label}{!(field as { optional?: boolean }).optional && " *"}</Label>
													<Select
														value={subTypeData[field.name] || ""}
														onValueChange={(v) =>
															setSubTypeData({
																...subTypeData,
																[field.name]: v,
															})
														}
													>
														<SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
															<SelectValue
																placeholder={`Select ${field.label}`}
															/>
														</SelectTrigger>
														<SelectContent className="bg-emerald-800 text-white">
															{field.options.map((opt) => (
																<SelectItem
																	key={opt}
																	value={opt}
																	className="focus:bg-emerald-700 focus:text-white"
																>
																	{opt}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</div>
											))}

											<div className="space-y-2">
												<Label>
													Tooth Selection (
													{toothSystem === "USA"
														? "USA Universal Numbering"
														: "FDI Numbering System"}
													)
												</Label>
												<ToothChart
													selected={teeth}
													onChange={setTeeth}
													system={toothSystem}
													onChangeSystem={setToothSystem}
												/>
											</div>

											<div className="space-y-2">
												<Label>Preferred Teeth Library</Label>
												<Select
													value={preferredTeethLibrary}
													onValueChange={setPreferredTeethLibrary}
												>
													<SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
														<SelectValue placeholder="Select Preferred Teeth Library" />
													</SelectTrigger>
													<SelectContent className="bg-emerald-800 text-white">
														<SelectItem
															value="default"
															className="focus:bg-emerald-700 focus:text-white"
														>
															Default Teeth Library
														</SelectItem>
														<SelectItem
															value="other"
															className="focus:bg-emerald-700 focus:text-white"
														>
															Other Teeth Library
														</SelectItem>
													</SelectContent>
												</Select>
											</div>

											{preferredTeethLibrary === "other" && (
												<div className="space-y-2">
													<Label>
														Teeth Library File (.dme or .zip, max 2GB)
													</Label>
													<input
														ref={libraryFileRef}
														type="file"
														className="hidden"
														onChange={(e) => {
															const file = e.target.files?.[0];
															if (file) handleLibraryFileSelect(file);
														}}
													/>
													{isLibraryUploading ? (
														<div className="border-2 border-dashed rounded-lg p-6 text-center border-emerald-500 bg-emerald-50/10">
															<div className="space-y-2">
																<Upload className="h-6 w-6 mx-auto text-emerald-600 animate-pulse" />
																<p className="text-sm font-medium text-foreground">
																	Uploading Teeth Library...{" "}
																	{libraryUploadProgress}%
																</p>
																<div className="w-full bg-muted rounded-full h-1.5 max-w-xs mx-auto">
																	<div
																		className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300"
																		style={{
																			width: `${libraryUploadProgress}%`,
																		}}
																	></div>
																</div>
															</div>
														</div>
													) : uploadedLibraryFile ? (
														<div className="flex items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg shadow-sm">
															<div className="flex items-center gap-3 min-w-0">
																<div className="p-2 bg-emerald-500/20 text-emerald-600 rounded-md shrink-0">
																	<FileArchive className="h-5 w-5" />
																</div>
																<div className="min-w-0">
																	<p className="text-sm font-semibold text-foreground truncate max-w-[280px] lg:max-w-[400px]">
																		{uploadedLibraryFile.fileName}
																	</p>
																	<div className="flex items-center gap-2 mt-0.5">
																		<p className="text-xs text-muted-foreground">
																			(
																			{(
																				uploadedLibraryFile.fileSize /
																				1024 /
																				1024
																			).toFixed(2)}{" "}
																			MB)
																		</p>
																		<span className="inline-flex items-center text-[10px] font-bold text-emerald-600 px-1.5 py-0.5 bg-emerald-500/20 rounded">
																			✓ Uploaded
																		</span>
																	</div>
																</div>
															</div>
															<div className="flex gap-2 shrink-0">
																<Button
																	type="button"
																	variant="outline"
																	size="sm"
																	onClick={(e) => {
																		e.preventDefault();
																		e.stopPropagation();
																		libraryFileRef.current?.click();
																	}}
																	className="h-9 text-xs flex items-center gap-1.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-600 hover:text-white bg-white font-medium"
																>
																	<RefreshCw className="h-3.5 w-3.5" /> Replace
																</Button>
																<Button
																	type="button"
																	variant="ghost"
																	size="icon"
																	onClick={async (e) => {
																		e.preventDefault();
																		e.stopPropagation();
																		await handleDeleteUploadedFile(
																			uploadedLibraryFile.fileName,
																		);
																		setUploadedLibraryFile(null);
																	}}
																	className="h-9 w-9 text-zinc-500 hover:text-red-500 hover:bg-red-50"
																>
																	<X className="h-4 w-4" />
																</Button>
															</div>
														</div>
													) : (
														<label className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors block border-border hover:border-emerald-800">
															<input
																type="file"
																className="hidden"
																onChange={(e) => {
																	const file = e.target.files?.[0];
																	if (file) handleLibraryFileSelect(file);
																}}
															/>
															<div>
																<Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
																<p className="text-sm font-medium text-foreground">
																	Click to upload Custom Teeth Library
																</p>
																<p className="text-xs text-muted-foreground mt-0.5">
																	ZIP or DME (Max 2GB)
																</p>
															</div>
														</label>
													)}
												</div>
											)}
										</>
									)}

									<div className="space-y-2">
										<Label>Additional Notes</Label>
										<Textarea
											placeholder="Special instructions, shade reference, occlusion notes…"
											value={notes}
											onChange={(e) => setNotes(e.target.value)}
										/>
									</div>
									<Button
										className="w-full bg-emerald-800 text-white hover:bg-emerald-900 font-semibold h-9 rounded-md text-xs mt-2 flex items-center justify-center gap-1.5"
										onClick={handleSubmit}
										disabled={
											isSubmitting ||
											isUploading ||
											isLibraryUploading ||
											submitCooldown
										}
									>
										{isSubmitting ? (
											<>
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
												Submitting...
											</>
										) : isUploading || isLibraryUploading ? (
											"Uploading Files..."
										) : (
											"Submit Case"
										)}
									</Button>
								</TabsContent>

								<TabsContent value="bulk" className="space-y-4 mt-4">
									{bulkRows.length === 0 ? (
										<label
											className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors block"
											onDragOver={(e) => e.preventDefault()}
											onDrop={(e) => {
												e.preventDefault();
												onBulkFiles(e.dataTransfer.files);
											}}
										>
											<input
												ref={bulkFileRef}
												type="file"
												multiple
												className="hidden"
												onChange={(e) => onBulkFiles(e.target.files)}
											/>
											<Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
											<p className="text-sm font-medium text-foreground">
												Select up to 10 case files
											</p>
											<p className="text-xs text-muted-foreground mt-1">
												PNG, JPG, MP4, PDF, ZIP, DOC, DOCX, TXT — one row per
												file (Max 2GB)
											</p>
										</label>
									) : (
										<>
											<input
												ref={bulkRowFileRef}
												type="file"
												className="hidden"
												onChange={(e) => {
													const file = e.target.files?.[0];
													if (file && replacingBulkRowIndex !== null) {
														handleBulkRowFileReplace(
															replacingBulkRowIndex,
															file,
														);
														setReplacingBulkRowIndex(null);
													}
												}}
											/>
											<div className="flex items-center justify-between">
												<p className="text-sm font-medium text-foreground">
													{bulkRows.length} cases ready
												</p>
												<div className="flex gap-2">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setBulkRows([])}
													>
														Clear
													</Button>
												</div>
											</div>
											<div className="space-y-3">
												{bulkRows.map((row, i) => (
													<Card key={i} className="shadow-sm">
														<CardContent className="p-4 space-y-3">
															<div className="flex items-center justify-between">
																<div className="flex items-center gap-2 min-w-0 flex-wrap">
																	<FileArchive className="h-4 w-4 text-emerald-600 shrink-0" />
																	<p className="text-sm font-medium text-foreground truncate">
																		{row.fileName}
																	</p>
																	{row.uploadedUrl && (
																		<span className="text-emerald-600 text-xs flex items-center font-semibold ml-1">
																			✓ Uploaded
																		</span>
																	)}
																	<Button
																		type="button"
																		variant="ghost"
																		size="icon"
																		title="Replace Case File"
																		className="h-6 w-6 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded ml-1"
																		onClick={(e) => {
																			e.preventDefault();
																			e.stopPropagation();
																			setReplacingBulkRowIndex(i);
																			setTimeout(
																				() => bulkRowFileRef.current?.click(),
																				50,
																			);
																		}}
																	>
																		<RefreshCw className="h-3 w-3" />
																	</Button>
																</div>
																<div className="flex items-center shrink-0">
																	<Button
																		type="button"
																		variant="ghost"
																		size="icon"
																		className="h-7 w-7 text-zinc-500 hover:text-red-500 hover:bg-red-50"
																		onClick={async () => {
																			if (row.uploadedFile) {
																				await handleDeleteUploadedFile(
																					row.uploadedFile.fileName,
																				);
																			}
																			removeBulkRow(i);
																		}}
																	>
																		<X className="h-4 w-4" />
																	</Button>
																</div>
															</div>
															{row.isUploading && (
																<div className="space-y-1">
																	<div className="w-full bg-muted rounded-full h-1">
																		<div
																			className="bg-emerald-600 h-1 rounded-full transition-all duration-300"
																			style={{
																				width: `${row.uploadProgress}%`,
																			}}
																		></div>
																	</div>
																	<p className="text-[10px] text-muted-foreground text-right">
																		Uploading... {row.uploadProgress}%
																	</p>
																</div>
															)}
															<div className="grid grid-cols-2 gap-3">
																<div className="space-y-1">
																	<Label className="text-xs">Category</Label>
																	<Select
																		value={row.category}
																		onValueChange={(v) =>
																			updateBulkRow(i, {
																				category: v,
																				subTypeData:
																					v === "Implant"
																						? { caseType2: "None" }
																						: {},
																			})
																		}
																	>
																		<SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900">
																			<SelectValue />
																		</SelectTrigger>
																		<SelectContent className="bg-emerald-800 text-white">
																			{Object.keys(CASE_HIERARCHY).map(
																				(cat) => (
																					<SelectItem
																						key={cat}
																						value={cat}
																						className="focus:bg-emerald-700 focus:text-white"
																					>
																						{cat}
																					</SelectItem>
																				),
																			)}
																		</SelectContent>
																	</Select>
																</div>
																<div className="space-y-1">
																	<Label className="text-xs">
																		Model Required? *
																	</Label>
																	<RadioGroup
																		value={row.modelRequired ?? undefined}
																		onValueChange={(v) =>
																			updateBulkRow(i, {
																				modelRequired: v as "yes" | "no",
																			})
																		}
																		className="flex gap-4 items-center pt-1"
																	>
																		<div className="flex items-center gap-1.5">
																			<RadioGroupItem
																				value="yes"
																				id={`bm-yes-${i}`}
																			/>
																			<Label
																				htmlFor={`bm-yes-${i}`}
																				className="text-xs"
																			>
																				Yes
																			</Label>
																		</div>
																		<div className="flex items-center gap-1.5">
																			<RadioGroupItem
																				value="no"
																				id={`bm-no-${i}`}
																			/>
																			<Label
																				htmlFor={`bm-no-${i}`}
																				className="text-xs"
																			>
																				No
																			</Label>
																		</div>
																	</RadioGroup>
																</div>
															</div>

															{/* Dynamic Fields */}
															{row.category === "Implant" ? (
																<>
																	<div className="space-y-1">
																		<Label className="text-xs">
																			Sub Type 1
																		</Label>
																		<Select
																			value={row.subTypeData["caseType1"] || ""}
																			onValueChange={(v) =>
																				updateBulkRow(i, {
																					subTypeData: {
																						...row.subTypeData,
																						caseType1: v,
																					},
																				})
																			}
																		>
																			<SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900">
																				<SelectValue placeholder="Select Sub Type 1" />
																			</SelectTrigger>
																			<SelectContent className="bg-emerald-800 text-white">
																				{CASE_HIERARCHY[
																					"Implant"
																				].fields[0].options.map((opt) => (
																					<SelectItem
																						key={opt}
																						value={opt}
																						className="focus:bg-emerald-700 focus:text-white"
																					>
																						{opt}
																					</SelectItem>
																				))}
																			</SelectContent>
																		</Select>
																	</div>

																	<div className="space-y-1">
																		<Label className="text-xs">
																			Teeth for Implant (
																			{row.toothSystem === "USA"
																				? "USA Universal Numbering"
																				: "FDI Numbering System"}
																			)
																		</Label>
																		<ToothChart
																			selected={row.teeth}
																			onChange={(t) =>
																				updateBulkRow(i, { teeth: t })
																			}
																			system={row.toothSystem}
																			onChangeSystem={(sys) =>
																				updateBulkRow(i, { toothSystem: sys })
																			}
																		/>
																	</div>

																	<div className="space-y-1">
																		<Label className="text-xs">
																			Crown & Bridge type (optional)
																		</Label>
																		<Select
																			value={
																				row.subTypeData["caseType2"] || "None"
																			}
																			onValueChange={(v) => {
																				const nextSubTypeData: Record<
																					string,
																					any
																				> = {
																					...row.subTypeData,
																					caseType2: v,
																				};
																				if (v === "None") {
																					delete nextSubTypeData.crownBridgeTeeth;
																				}
																				updateBulkRow(i, {
																					subTypeData: nextSubTypeData,
																				});
																			}}
																		>
																			<SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900">
																				<SelectValue placeholder="Select Crown & Bridge type" />
																			</SelectTrigger>
																			<SelectContent className="bg-emerald-800 text-white">
																				{CASE_HIERARCHY[
																					"Implant"
																				].fields[1].options.map((opt) => (
																					<SelectItem
																						key={opt}
																						value={opt}
																						className="focus:bg-emerald-700 focus:text-white"
																					>
																						{opt}
																					</SelectItem>
																				))}
																			</SelectContent>
																		</Select>
																	</div>

																	{row.subTypeData.caseType2 &&
																		row.subTypeData.caseType2 !== "None" && (
																			<div className="space-y-1">
																				<Label className="text-xs">
																					Teeth for Crown & Bridge (
																					{row.toothSystem === "USA"
																						? "USA Universal Numbering"
																						: "FDI Numbering System"}
																					)
																				</Label>
																				<ToothChart
																					selected={
																						row.subTypeData.crownBridgeTeeth ||
																						[]
																					}
																					onChange={(t) =>
																						updateBulkRow(i, {
																							subTypeData: {
																								...row.subTypeData,
																								crownBridgeTeeth: t,
																							},
																						})
																					}
																					system={row.toothSystem}
																					onChangeSystem={(sys) =>
																						updateBulkRow(i, {
																							toothSystem: sys,
																						})
																					}
																				/>
																			</div>
																		)}
																</>
															) : (
																<>
																	{CASE_HIERARCHY[
																		row.category as keyof typeof CASE_HIERARCHY
																	]?.fields.map((field) => (
																		<div className="space-y-1" key={field.name}>
																			<Label className="text-xs">
																				{field.label}
																				{!(field as { optional?: boolean }).optional && " *"}
																			</Label>
																			<Select
																				value={
																					row.subTypeData[field.name] || ""
																				}
																				onValueChange={(v) =>
																					updateBulkRow(i, {
																						subTypeData: {
																							...row.subTypeData,
																							[field.name]: v,
																						},
																					})
																				}
																			>
																				<SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900">
																					<SelectValue
																						placeholder={`Select ${field.label}`}
																					/>
																				</SelectTrigger>
																				<SelectContent className="bg-emerald-800 text-white">
																					{field.options.map((opt) => (
																						<SelectItem
																							key={opt}
																							value={opt}
																							className="focus:bg-emerald-700 focus:text-white"
																						>
																							{opt}
																						</SelectItem>
																					))}
																				</SelectContent>
																			</Select>
																		</div>
																	))}
																	<ToothChart
																		selected={row.teeth}
																		onChange={(t) =>
																			updateBulkRow(i, { teeth: t })
																		}
																		system={row.toothSystem}
																		onChangeSystem={(sys) =>
																			updateBulkRow(i, { toothSystem: sys })
																		}
																	/>
																</>
															)}
															<Textarea
																value={row.notes}
																onChange={(e) =>
																	updateBulkRow(i, { notes: e.target.value })
																}
																placeholder="Notes for this case…"
																className="min-h-60px"
															/>
														</CardContent>
													</Card>
												))}
											</div>
											<Button
												className="w-full bg-emerald-800 text-white hover:bg-emerald-900 font-semibold h-9 rounded-md text-xs mt-2 flex items-center justify-center gap-1.5"
												onClick={handleBulkSubmit}
												disabled={
													isSubmitting ||
													submitCooldown ||
													bulkRows.some((row) => row.isUploading)
												}
											>
												{isSubmitting ? (
													<>
														<Loader2 className="h-3.5 w-3.5 animate-spin" />
														Submitting...
													</>
												) : (
													"Submit All Cases"
												)}
											</Button>
										</>
									)}
								</TabsContent>

								{/* forceMount so uploads/drafts survive a tab switch; the
									dialog still unmounts it on close for a fresh start. */}
								<TabsContent
									value="xml"
									forceMount
									className="mt-4 data-[state=inactive]:hidden"
								>
									<ThreeShapeImport
										onSubmitted={() => {
											pageLimitRef.current += 1;
											fetchCases();
										}}
										onClose={() => setUploadOpen(false)}
									/>
								</TabsContent>
							</Tabs>
						</DialogContent>
					</Dialog>
				</div>
			</div>

			{/* Filters */}
			<Card className="shadow-card border-border/50">
				<CardContent className="p-3 space-y-2">
					<div className="flex flex-col lg:flex-row gap-2">
						<div className="relative flex-1">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
							<Input
								className="pl-9 h-8 text-xs"
								placeholder="Search cases..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
							/>
						</div>
						<Select value={typeFilter} onValueChange={(v) => setTypeFilter(v)}>
							<SelectTrigger className="w-full lg:w-48 h-8 text-xs">
								<SelectValue placeholder="Case type" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="All">All Case Types</SelectItem>
								{Object.keys(CASE_HIERARCHY).map((t) => (
									<SelectItem key={t} value={t}>
										{t}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Input
							type="date"
							value={from}
							onChange={(e) => setFrom(e.target.value)}
							className="w-full lg:w-36 h-8 text-xs"
						/>
						<Input
							type="date"
							value={to}
							onChange={(e) => setTo(e.target.value)}
							className="w-full lg:w-36 h-8 text-xs"
						/>
						<Button
							variant="outline"
							size="sm"
							className="h-8 text-xs"
							onClick={() => {
								setSearch("");
								setTypeFilter("All");
								setStatusFilter("All");
								setFrom("");
								setTo("");
							}}
						>
							Clear
						</Button>
					</div>
					<div className="flex gap-1 flex-wrap">
						{statusFilters.map((s) => (
							<Button
								key={s}
								variant={statusFilter === s ? "default" : "outline"}
								size="sm"
								className="h-7 text-[10px] px-2"
								onClick={() => setStatusFilter(s)}
							>
								{s}
							</Button>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Table */}
			<Card className="shadow-card border-border/50">
				<CardContent className="p-0">
					<div className="overflow-x-auto">
						<table className="w-full">
							<thead className="bg-muted/30">
								<tr className="border-b border-border">
									{[
										"Case ID",
										"Case Name",
										"Type",
										"Case Sub Type",
										"Teeth",
										"Status",
										"Designer",
										"CreatedAt",
										"Actions",
									].map((h) => (
										<th
											key={h}
											className="text-left text-xs font-semibold text-muted-foreground px-3.5 py-2"
										>
											{h}
										</th>
									))}
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{isLoading
									? Array.from({ length: 5 }).map((_, idx) => (
											<tr key={idx} className="animate-pulse">
												<td className="px-3.5 py-2.5">
													<div className="h-3.5 bg-muted rounded w-20"></div>
												</td>
												<td className="px-3.5 py-2.5">
													<div className="h-3.5 bg-muted rounded w-20"></div>
												</td>
												<td className="px-3.5 py-2.5">
													<div className="h-3.5 bg-muted rounded w-24"></div>
												</td>
												<td className="px-3.5 py-2.5">
													<div className="h-3.5 bg-muted rounded w-28"></div>
												</td>
												<td className="px-3.5 py-2.5">
													<div className="h-3.5 bg-muted rounded w-12"></div>
												</td>
												<td className="px-3.5 py-2.5">
													<div className="h-5.5 bg-muted rounded-full w-20"></div>
												</td>
												<td className="px-3.5 py-2.5">
													<div className="h-3.5 bg-muted rounded w-20"></div>
												</td>
												<td className="px-3.5 py-2.5">
													<div className="h-3.5 bg-muted rounded w-16"></div>
												</td>
												<td className="px-3.5 py-2.5">
													<div className="h-6 bg-muted rounded w-24"></div>
												</td>
											</tr>
										))
									: filtered.map((c) => {
											const toothNumbers = c.subTypeData?.teeth || [];
											const toothSystem = c.subTypeData?.toothSystem || "USA";
											const restoration = c.subTypeData
												? Object.entries(c.subTypeData)
														.filter(
															([k, v]) =>
																k !== "teeth" &&
																k !== "crownBridgeTeeth" &&
																k !== "toothSystem" &&
																k !== "notes" &&
																k !== "modelRequired" &&
																typeof v === "string" &&
																v &&
																v.toLowerCase() !== "none",
														)
														.map(([, v]) => v)
														.join(" - ")
												: c.category || "—";

											const createdAtFormatted = c.createdAt
												? new Date(c.createdAt).toLocaleDateString("en-US", {
														month: "short",
														day: "numeric",
														year: "numeric",
													})
												: "—";

											return (
												<tr
													key={c.id}
													className={`cursor-pointer transition-colors border-l-2 ${c.status === "on_hold" ? "bg-red-50 hover:bg-red-100/80 border-l-red-500" : c.status === "submitted_to_client" ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.08] border-l-amber-500 font-medium" : "hover:bg-muted/10 border-l-transparent"}`}
													onClick={() => router.push(`/client/cases/${c.id}`)}
												>
													<td className="px-3.5 py-2">
														<div className="flex items-center gap-1.5">
															<span className="font-semibold text-[11px] text-slate-800">
																{c.caseNumber || c.id}
															</span>
															{(() => {
																const hasUnreadChat = Boolean(c.hasUnreadChat);
																const todayCount =
																	(c as any).todayMessagesCount || 0;
																if (!hasUnreadChat && todayCount === 0)
																	return null;
																return (
																	<span
																		className="relative inline-flex items-center shrink-0"
																		title={
																			hasUnreadChat
																				? "New Messages"
																				: `${todayCount} messages today`
																		}
																	>
																		<MessageSquare
																			className={`h-3.5 w-3.5 shrink-0 ${hasUnreadChat ? "text-emerald-500" : "text-slate-400"}`}
																		/>
																		{hasUnreadChat ? (
																			<span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
																				<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
																				<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
																			</span>
																		) : (
																			<span className="absolute -top-1.5 -right-1.5 min-w-3 h-3 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-bold border border-white leading-none">
																				{todayCount}
																			</span>
																		)}
																	</span>
																);
															})()}
														</div>
													</td>
													<td className="px-3.5 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
														{removeExtensionFromString(c.scanFileName || "—")}
													</td>
													<td className="px-3.5 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
														{c.category}
													</td>
													<td className="px-3.5 py-2 text-[11px] text-foreground font-semibold">
														{restoration || "—"}
													</td>
													<td className="px-3.5 py-2 text-[10px] text-muted-foreground">
														{c.category === "Implant" ? (
															<div className="flex flex-col">
																<span>
																	Imp:{" "}
																	{toothNumbers.length
																		? `#${toothNumbers.join(", #")}`
																		: "—"}
																</span>
																{(() => {
																	const cbToothNumbers =
																		c.subTypeData?.crownBridgeTeeth || [];
																	return (
																		cbToothNumbers.length > 0 && (
																			<span>
																				C&B: #{cbToothNumbers.join(", #")}
																			</span>
																		)
																	);
																})()}
															</div>
														) : toothNumbers.length ? (
															`#${toothNumbers.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})`
														) : (
															"—"
														)}
													</td>
													<td className="px-3.5 py-2">
														<div className="scale-90 origin-left">
															<StatusBadge status={c.status} />
														</div>
													</td>
													<td className="px-3.5 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
														{c.designerName || "—"}
													</td>
													<td className="px-3.5 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
														{createdAtFormatted}
													</td>
													<td className="px-3.5 py-2 whitespace-nowrap">
														{HOLDABLE_STATUSES.includes(c.status) && (
															<Button
																size="sm"
																variant="secondary"
																className="h-7 text-[10px] px-2 py-0.5 font-semibold gap-1"
																onClick={(e) => {
																	e.stopPropagation();
																	openHoldDialog(c.id);
																}}
															>
																<PauseCircle className="h-3.5 w-3.5" /> Put on
																Hold
															</Button>
														)}
													</td>
												</tr>
											);
										})}
								{!isLoading && filtered.length === 0 && (
									<tr>
										<td
											colSpan={9}
											className="px-3.5 py-8 text-center text-xs text-muted-foreground"
										>
											No cases match your filters
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					{!isLoading && hasMore && (
						<div className="p-3 border-t border-border/50 flex justify-center">
							<Button
								variant="outline"
								size="sm"
								className="h-8 text-xs gap-1.5"
								onClick={handleLoadMore}
								disabled={isLoadingMore}
							>
								{isLoadingMore ? (
									<>
										<RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />
										Loading...
									</>
								) : (
									"Load more cases"
								)}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={!!holdCaseId}
				onOpenChange={(open) => {
					if (!open && !isHoldSubmitting) setHoldCaseId(null);
				}}
			>
				<DialogContent className="sm:max-w-[480px]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							⏸ Put Case on Hold
						</DialogTitle>
						<p className="text-xs text-muted-foreground">
							Please specify the reason before putting this case on hold.
						</p>
					</DialogHeader>

					<div className="grid gap-4 py-2">
						<div className="space-y-2">
							<Label htmlFor="cases-hold-reason-select">Hold Reason</Label>
							<Select
								value={holdReasonSelect}
								onValueChange={setHoldReasonSelect}
							>
								<SelectTrigger id="cases-hold-reason-select" className="w-full">
									<SelectValue placeholder="Select a hold reason..." />
								</SelectTrigger>
								<SelectContent>
									{HOLD_REASONS.map((reason) => (
										<SelectItem key={reason} value={reason}>
											{reason}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{holdReasonSelect === "Other (please specify)" && (
							<div className="space-y-2">
								<Label htmlFor="cases-hold-custom-reason">
									Specify details
								</Label>
								<Textarea
									id="cases-hold-custom-reason"
									value={holdCustomReason}
									onChange={(e) => setHoldCustomReason(e.target.value)}
									placeholder="Please specify other hold reason details..."
									className="min-h-[100px]"
								/>
							</div>
						)}
					</div>

					<div className="flex justify-end gap-2 mt-2">
						<Button
							variant="outline"
							onClick={() => setHoldCaseId(null)}
							disabled={isHoldSubmitting}
						>
							Cancel
						</Button>
						<Button
							onClick={handleConfirmHold}
							disabled={
								isHoldSubmitting ||
								!holdReasonSelect ||
								(holdReasonSelect === "Other (please specify)" &&
									!holdCustomReason.trim())
							}
							className="bg-emerald-600 hover:bg-emerald-700 text-white"
						>
							{isHoldSubmitting ? "Putting on hold..." : "Confirm"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
