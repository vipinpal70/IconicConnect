"use client"

import { useMemo, useState, useRef, useEffect } from "react";
import { generateCaseId, HOLD_REASONS } from "@/src/lib/case-utils";
import { OpsLayout } from "@/src/components/OpsLayout";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { StatusBadge } from "@/src/components/StatusBadge";
import { ToothChart } from "@/src/components/ToothChart";
import { Plus, Search, Download, Upload, X, FileBox, UserPlus, ClipboardCheck, ShieldCheck, RefreshCw, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Label } from "@/src/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { CASE_APPROVAL_CHECKLIST as QC_CHECKLIST } from "@/src/lib/case-approval";

interface BulkRow {
  fileName: string;
  file: File;
  category: string;
  subTypeData: Record<string, string>;
  modelRequired: "yes" | "no";
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

type OpsMember = {
  id: string;
  role: string;
  email?: string | null;
  fullName?: string | null;
  status?: string | null;
};

type ProfileSummary = {
  id: string;
  role: string;
  fullName: string | null;
  createdBy?: string | null;
};

type OpsCase = {
  id: string;
  clientId?: string | null;
  subuserId?: string | null;
  caseNumber?: string | null;
  category?: string | null;
  status: string;
  createdAt?: string | Date | null;
  designerId?: string | null;
  designerName?: string | null;
  qcId?: string | null;
  accountManagerId?: string | null;
  subTypeData?: Record<string, string | number | number[] | null | undefined> & {
    teeth?: number[];
    toothSystem?: "USA" | "FDI";
  };
  outputFile?: string | null;
  previewFile?: string | null;
  outputNote?: string | null;
  todayMessagesCount?: number;
  hasUnreadChat?: boolean;
};

function shouldShowChatIcon(caseItem: OpsCase, currentUser: ProfileSummary | null | undefined) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'client' && caseItem.clientId === currentUser.id) return true;
  if (currentUser.role === 'subuser' && (caseItem.subuserId === currentUser.id || caseItem.clientId === currentUser.createdBy)) return true;
  if (caseItem.designerId === currentUser.id || caseItem.qcId === currentUser.id || caseItem.accountManagerId === currentUser.id) return true;
  return false;
}


type CaseActionType = "approve" | "reject" | "feedback" | "hold";

type CaseActionDialogState = {
  caseId: string;
  action: CaseActionType;
  caseNumber?: string | null;
} | null;

const CASE_ACTIONS: Record<
  CaseActionType,
  {
    title: string;
    description: string;
    status: "submitted_to_client" | "in_progress" | "on_hold";
    successMessage: string;
    reasonKey?: "holdReason" | "feedbackReason" | "rejectReason";
    reasonLabel?: string;
    confirmLabel: string;
  }
> = {
  approve: {
    title: "Approve Case",
    description: "Complete the QC checklist before approving and sending to the client.",
    status: "submitted_to_client",
    successMessage: "Approved QC and sent design to client",
    confirmLabel: "Approve",
  },
  reject: {
    title: "Reject Case",
    description: "Add the reason before sending the case back to the designer.",
    status: "in_progress",
    successMessage: "Rejected design; sent back to designer",
    reasonKey: "rejectReason",
    reasonLabel: "Reject reason",
    confirmLabel: "Confirm",
  },
  feedback: {
    title: "Add Feedback",
    description: "Add the feedback reason before sending the case back to the designer.",
    status: "in_progress",
    successMessage: "Feedback logged; sent back to designer",
    reasonKey: "feedbackReason",
    reasonLabel: "Feedback reason",
    confirmLabel: "Confirm",
  },
  hold: {
    title: "Hold Case",
    description: "Add the hold reason before putting this case on hold.",
    status: "on_hold",
    successMessage: "Case put on hold by QC Lead",
    reasonKey: "holdReason",
    reasonLabel: "Hold reason",
    confirmLabel: "Confirm",
  },
};

const uploadFileWithXHR = async (
  file: File,
  labName: string,
  onProgress: (progress: number) => void,
  onSuccess: (res: { fileUrl: string; fileName: string; fileSize: number; fileType: string }) => void,
  onError: (err: string) => void
) => {
  try {
    const url = `/api/cases/upload?fileName=${encodeURIComponent(file.name)}`;
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          onSuccess(JSON.parse(xhr.responseText));
        } catch {
          onError("Failed to parse response");
        }
      } else {
        onError("Upload failed with status " + xhr.status);
      }
    };
    xhr.onerror = () => onError("Upload failed");
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  } catch (err: unknown) {
    onError(err instanceof Error ? err.message : "Initialization failed");
  }
};

const validateFile = (file: File): { isValid: boolean; error?: string } => {
  const maxLimit = 2 * 1024 * 1024 * 1024;
  if (file.size > maxLimit) {
    return { isValid: false, error: `File size exceeds the 2GB limit. Size: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB` };
  }
  const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
  const allowedExtensions = [
    ".png", ".jpg", ".jpeg",
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".wmv", ".flv", ".3gp", ".mpeg", ".mpg",
    ".pdf", ".zip", ".doc", ".docx", ".txt",
  ];
  if (!allowedExtensions.includes(ext)) {
    return { isValid: false, error: `File type "${ext}" is not supported.` };
  }
  return { isValid: true };
};

const statusFilters: string[] = [
  "All", "Submitted", "In Validation", "In Design", "Internal QC",
  "Pending Client Approval", "Feedback", "On Hold", "Completed", "Cancelled",
];

const hasAllRequiredCaseFields = (
  category: string,
  subTypeData: Record<string, string>,
  notes: string,
  teeth: number[],
  uploadedFile: unknown
) => {
  const fields = CASE_HIERARCHY[category as keyof typeof CASE_HIERARCHY]?.fields || [];
  const allDynamicFieldsSelected = fields.every((field) => Boolean(subTypeData[field.name]));
  return Boolean(category && uploadedFile && allDynamicFieldsSelected && teeth.length > 0);
};

const CASE_HIERARCHY = {
  "Crown & Bridges": {
    fields: [
      { name: "caseType", label: "Case Type", type: "select", options: ["Crown", "Bridge", "Cutback", "Coping", "Screw Retained", "In-Lay", "On-Lay"] },
    ],
  },
  "Denture": {
    fields: [
      { name: "caseType1", label: "Case Type 1", type: "select", options: ["Reference Denture", "Copy Denture", "Immediate Denture", "Full Denture", "Partial Denture"] },
      { name: "caseType2", label: "Case Type 2", type: "select", options: ["Lower", "Upper", "Both Arches"] },
    ],
  },
  "Cosmetics": {
    fields: [
      { name: "caseType", label: "Case Type", type: "select", options: ["Digital Wax Up", "Vineers", "Snap on Smile"] },
    ],
  },
  "Appliances": {
    fields: [
      { name: "caseType1", label: "Case Type 1", type: "select", options: ["Night Guards", "Sports Guard", "Mouth Guard", "NTI"] },
      { name: "occlusion", label: "Occlusion", type: "select", options: ["even occlusion", "custom"] },
      { name: "arch", label: "Arch", type: "select", options: ["Lower", "Upper"] },
    ],
  },
  "Implant": {
    fields: [
      { name: "caseType1", label: "Case Type 1", type: "select", options: ["Robotic", "Custom", "Ti-Base"] },
      { name: "caseType2", label: "Case Type 2", type: "select", options: ["crown", "bridge", "coping", "screw retained", "in-lay", "on-lay"] },
    ],
  },
};

export default function CasesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [typeFilter, setTypeFilter] = useState<string | "All">("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  const [cases, setCases] = useState<OpsCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCases = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const res = await fetch("/api/cases");
      if (res.ok) {
        const json = await res.json();
        setCases(json.data || []);
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void fetchCases(); }, 0);
    const intervalId = window.setInterval(() => { void fetchCases(false); }, 8000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, []);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [assignQcCaseId, setAssignQcCaseId] = useState<string | null>(null);
  const [selectedQcId, setSelectedQcId] = useState<string>("");
  const [pendingCaseAction, setPendingCaseAction] = useState<CaseActionDialogState>(null);
  const [caseActionReason, setCaseActionReason] = useState("");
  const [holdReasonSelect, setHoldReasonSelect] = useState("");
  const [approveChecklist, setApproveChecklist] = useState<Record<string, boolean>>({});
  const [designUploadCaseId, setDesignUploadCaseId] = useState<string | null>(null);
  const [designUploadCaseNumber, setDesignUploadCaseNumber] = useState<string | null>(null);
  const [designUploadClientId, setDesignUploadClientId] = useState<string | null>(null);
  const [designUploadNote, setDesignUploadNote] = useState("");
  const [designUploadFile, setDesignUploadFile] = useState<File | null>(null);
  const [designUploadPreviewFile, setDesignUploadPreviewFile] = useState<File | null>(null);
  const [isDesignUploading, setIsDesignUploading] = useState(false);
  const designUploadInputRef = useRef<HTMLInputElement>(null);
  const previewUploadInputRef = useRef<HTMLInputElement>(null);

  const { data: membersData } = useQuery<OpsMember[]>({
    queryKey: ["ops-members-list"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/admin/members", { cache: "no-store" });
        if (!res.ok) {
          console.error("fetch /api/admin/members failed status:", res.status);
          return [];
        }
        const data = await res.json();
        console.log("fetch /api/admin/members returned:", data);
        return data;
      } catch (err) {
        console.error("fetch /api/admin/members error:", err);
        return [];
      }
    },
  });

  const { data: currentUser } = useQuery<ProfileSummary | null>({
    queryKey: ["ops-me"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const handleUpdate = async (
    caseId: string,
    patch: Record<string, string | number | boolean | null>,
    successMessage: string
  ): Promise<boolean> => {
    setUpdatingId(caseId);
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        toast.success(successMessage);
        fetchCases();
        return true;
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to update case");
        return false;
      }
    } catch {
      toast.error("Failed to update case");
      return false;
    } finally {
      setUpdatingId(null);
    }
  };

  // FIX: Removed setTimeout — it caused a race condition where Radix's outside-click
  // handler would fire after the tick and immediately close the dialog before it opened.
  const openCaseActionDialog = (caseId: string, action: CaseActionType, caseNumber?: string | null) => {
    setPendingCaseAction({ caseId, action, caseNumber });
    setCaseActionReason("");
    setHoldReasonSelect("");
    setApproveChecklist({});

    if (action === "approve") {
      void (async () => {
        try {
          const res = await fetch(`/api/cases/${caseId}/approval-checklist`);
          if (!res.ok) return;
          const payload = await res.json().catch(() => ({}));
          const values = Array.isArray(payload?.data) ? payload.data : [];
          const selected = new Set(values);
          setApproveChecklist(
            Object.fromEntries(QC_CHECKLIST.map((item) => [item, selected.has(item)]))
          );
        } catch {
          // Leave checklist empty if it cannot be loaded.
        }
      })();
    }
  };

  const closeCaseActionDialog = () => {
    setPendingCaseAction(null);
    setCaseActionReason("");
    setHoldReasonSelect("");
    setApproveChecklist({});
  };

  const confirmCaseAction = async () => {
    if (!pendingCaseAction) return;
    const actionConfig = CASE_ACTIONS[pendingCaseAction.action];
    let reason = caseActionReason.trim();

    if (pendingCaseAction.action === "approve") {
      const allChecked = QC_CHECKLIST.every((item) => approveChecklist[item]);
      if (!allChecked) {
        toast.error("Please complete all QC checklist items before approving.");
        return;
      }

      setUpdatingId(pendingCaseAction.caseId);
      try {
        const checkedItems = QC_CHECKLIST.filter((item) => approveChecklist[item]);
        const res = await fetch(`/api/cases/${pendingCaseAction.caseId}/approval-checklist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkedItems }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to approve case");
        }
        toast.success(actionConfig.successMessage);
        fetchCases();
        closeCaseActionDialog();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to approve case";
        toast.error(msg);
      } finally {
        setUpdatingId(null);
      }
      return;
    } else if (pendingCaseAction.action === "hold") {
      if (!holdReasonSelect) {
        toast.error("Please select a hold reason.");
        return;
      }
      if (holdReasonSelect === "Other (please specify)") {
        if (!reason) {
          toast.error("Please specify your reason for holding the case.");
          return;
        }
      } else {
        reason = holdReasonSelect;
      }
    } else {
      if (actionConfig.reasonKey && !reason) {
        toast.error(`Please enter a ${actionConfig.reasonLabel?.toLowerCase() || "reason"}.`);
        return;
      }
    }

    const patch = actionConfig.reasonKey
      ? { status: actionConfig.status, [actionConfig.reasonKey]: reason }
      : { status: actionConfig.status };
    const updated = await handleUpdate(pendingCaseAction.caseId, patch, actionConfig.successMessage);
    if (updated) closeCaseActionDialog();
  };

  const openDesignUploadDialog = (caseId: string, caseNumber?: string | null, clientId?: string | null) => {
    setDesignUploadCaseId(caseId);
    setDesignUploadCaseNumber(caseNumber || null);
    setDesignUploadClientId(clientId || null);
    setDesignUploadNote("");
    setDesignUploadFile(null);
    setDesignUploadPreviewFile(null);
    if (designUploadInputRef.current) designUploadInputRef.current.value = "";
    if (previewUploadInputRef.current) previewUploadInputRef.current.value = "";
  };

  const closeDesignUploadDialog = () => {
    setDesignUploadCaseId(null);
    setDesignUploadCaseNumber(null);
    setDesignUploadClientId(null);
    setDesignUploadNote("");
    setDesignUploadFile(null);
    setDesignUploadPreviewFile(null);
    if (designUploadInputRef.current) designUploadInputRef.current.value = "";
    if (previewUploadInputRef.current) previewUploadInputRef.current.value = "";
  };

  const uploadLocalFile = async (file: File, clientId: string): Promise<string> => {
    const url = `/api/cases/upload?fileName=${encodeURIComponent(file.name)}&clientId=${encodeURIComponent(clientId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to upload file using existing upload API");
    }
    const data = await res.json();
    return data.fileUrl;
  };

  const validateHtmlFile = (file: File): { isValid: boolean; error?: string } => {
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (ext !== ".html" && ext !== ".htm") {
      return { isValid: false, error: "Only HTML files (.html, .htm) are allowed for 3D preview." };
    }
    return { isValid: true };
  };

  const confirmDesignUpload = async () => {
    if (!designUploadCaseId) return;
    if (!designUploadFile) { toast.error("Please select an output file."); return; }
    if (!designUploadNote.trim()) { toast.error("Please add output note/details before uploading."); return; }
    const fileCheck = validateFile(designUploadFile);
    if (!fileCheck.isValid) { toast.error(fileCheck.error || "Invalid file"); return; }

    if (designUploadPreviewFile) {
      const previewCheck = validateHtmlFile(designUploadPreviewFile);
      if (!previewCheck.isValid) { toast.error(previewCheck.error || "Invalid preview file"); return; }
    }

    setIsDesignUploading(true);
    try {
      // 1. Upload output file using existing upload api
      const outputUrl = await uploadLocalFile(designUploadFile, designUploadClientId || "");

      // 2. Upload preview file if present
      let previewUrl = null;
      if (designUploadPreviewFile) {
        previewUrl = await uploadLocalFile(designUploadPreviewFile, designUploadClientId || "");
      }

      // 3. Link them to the case database structure
      const patch = {
        outputFile: outputUrl,
        previewFile: previewUrl,
        outputNote: designUploadNote.trim(),
      };

      const updated = await handleUpdate(designUploadCaseId, patch, "Design output and preview files uploaded successfully");
      if (updated) {
        // Log design note as file/note attachment if note is provided
        try {
          const formData = new FormData();
          formData.append("note", designUploadNote.trim());
          await fetch(`/api/cases/${designUploadCaseId}/files`, { method: "POST", body: formData });
        } catch (e) {
          console.error("Failed to save design note as attachment:", e);
        }
        closeDesignUploadDialog();
        fetchCases();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload files");
    } finally {
      setIsDesignUploading(false);
    }
  };

  // FIX: Use `status` (the correct field name on OpsMember)
  const designers = useMemo(() => {
    if (!membersData) return [];
    return membersData.filter((m) => m.role === "designer" && m.status === "active");
  }, [membersData]);

  const qcs = useMemo(() => {
    if (!membersData) return [];
    return membersData.filter((m) => m.role === "qc" && m.status === "active");
  }, [membersData]);

  // Add Case form state
  const [category, setCategory] = useState<string>("Crown & Bridges");
  const [subTypeData, setSubTypeData] = useState<Record<string, string>>({});
  const [modelRequired, setModelRequired] = useState("no");
  const [teeth, setTeeth] = useState<number[]>([]);
  const [toothSystem, setToothSystem] = useState<"USA" | "FDI">("USA");
  const [notes, setNotes] = useState("");
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ fileUrl: string; fileName: string; fileSize: number; fileType: string } | null>(null);
  const [labName, setLabName] = useState<string>("Client");
  const [userProfile, setUserProfile] = useState<ProfileSummary | null>(null);
  const generatedCaseId = useMemo(() => generateCaseId(category), [category]);

  // Refs for replacement triggering
  const singleFileRef = useRef<HTMLInputElement>(null);
  const bulkRowFileRef = useRef<HTMLInputElement>(null);
  const [replacingBulkRowIndex, setReplacingBulkRowIndex] = useState<number | null>(null);

  const activeUser = userProfile || currentUser;
  const activeUserRole = activeUser?.role || "";
  const activeUserId = activeUser?.id || "";

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch("/api/profile");
        if (res.ok) {
          const profile = await res.json();
          if (profile) {
            setUserProfile({ id: profile.id, role: profile.role, fullName: profile.fullName || null });
            if (profile.labName) setLabName(profile.labName);
          }
        }
      } catch (err) {
        console.error("Error fetching operations profile:", err);
      }
    }
    fetchProfile();
  }, []);

  const handleDeleteUploadedFile = async (fileName: string) => {
    try {
      await fetch(`/api/cases/files?labName=${encodeURIComponent(labName)}&fileName=${encodeURIComponent(fileName)}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error("Failed to delete local case file:", e);
    }
  };

  const handleFileSelect = async (file: File) => {
    const check = validateFile(file);
    if (!check.isValid) { window.alert(check.error); return; }
    setSingleFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    uploadFileWithXHR(
      file, labName,
      (progress) => setUploadProgress(progress),
      (res) => { setUploadProgress(100); setUploadedFileUrl(res.fileUrl); setUploadedFile(res); setTimeout(() => setIsUploading(false), 500); },
      (err) => { console.error("Upload error:", err); setIsUploading(false); setUploadProgress(0); }
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
      }
    );
  };

  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    return cases.filter((c) => {
      const s = search.toLowerCase();
      const friendlyId = (c.caseNumber || c.id || "").toLowerCase();
      const friendlyRestoration = (
        c.subTypeData
          ? Object.entries(c.subTypeData)
            .filter(([k, v]) => k !== "teeth" && k !== "notes" && k !== "modelRequired" && typeof v === "string" && v)
            .map(([, v]) => v).join(" - ")
          : c.category || ""
      ).toLowerCase();

      const matchesSearch = !s || friendlyId.includes(s) || friendlyRestoration.includes(s);

      const statusFilterMap: Record<string, string[]> = {
        "Submitted": ["scan_received"],
        "In Validation": ["scan_verified"],
        "In Design": ["allocated_to_designer", "in_progress"],
        "Internal QC": ["internal_qc"],
        "Pending Client Approval": ["submitted_to_client"],
        "Feedback": ["client_feedback"],
        "On Hold": ["on_hold", "scan_not_verified"],
        "Completed": ["approved", "delivered"],
        "Cancelled": ["cancelled"],
      };

      const matchesStatus = statusFilter === "All" || (statusFilterMap[statusFilter]?.includes(c.status) ?? false);
      const matchesType = typeFilter === "All" || c.category === typeFilter;
      const createdAtDate = c.createdAt ? new Date(c.createdAt).toISOString().split("T")[0] : "";
      const matchesFrom = !from || createdAtDate >= from;
      const matchesTo = !to || createdAtDate <= to;

      return matchesSearch && matchesStatus && matchesType && matchesFrom && matchesTo;
    });
  }, [cases, search, statusFilter, typeFilter, from, to]);

  const handleSubmit = async () => {
    if (!hasAllRequiredCaseFields(category, subTypeData, notes, teeth, uploadedFile)) {
      toast.error("Please complete all fields, select teeth, and upload a file.");
      return;
    }
    const formData = new FormData();
    const caseData = {
      category,
      subTypeData: { ...subTypeData, modelRequired, teeth, toothSystem, notes },
      caseNumber: generatedCaseId,
      uploadedFile,
    };
    formData.append("cases", JSON.stringify(caseData));
    try {
      const res = await fetch("/api/cases", { method: "POST", body: formData });
      if (res.ok) {
        toast.success("Case submitted successfully!");
        setUploadOpen(false);
        setNotes(""); setTeeth([]); setToothSystem("USA"); setModelRequired("no");
        setCategory("Crown & Bridges"); setSubTypeData({});
        setSingleFile(null); setUploadedFileUrl(null); setUploadedFile(null);
        fetchCases();
      } else {
        toast.error("Failed to submit case.");
      }
    } catch (error) {
      toast.error("An error occurred during submission.");
      console.error("Single submit error:", error);
    }
  };

  const onBulkFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const pickedFiles = Array.from(files).slice(0, 10);
    for (const f of pickedFiles) {
      const check = validateFile(f);
      if (!check.isValid) { window.alert(`File "${f.name}": ${check.error}`); return; }
    }
    const rows: BulkRow[] = pickedFiles.map((f) => ({
      fileName: f.name, file: f, category: "Crown & Bridges", subTypeData: {},
      modelRequired: "no", teeth: [], toothSystem: "USA", notes: "",
      uploadProgress: 0, uploadedUrl: null, isUploading: true,
      caseId: generateCaseId("Crown & Bridges"),
    }));
    setBulkRows(rows);
    rows.forEach((row) => {
      uploadFileWithXHR(
        row.file, labName,
        (progress) => setBulkRows((prev) => prev.map((r) => r.caseId === row.caseId ? { ...r, uploadProgress: progress } : r)),
        (res) => setBulkRows((prev) => prev.map((r) => r.caseId === row.caseId ? { ...r, uploadProgress: 100, isUploading: false, uploadedUrl: res.fileUrl, uploadedFile: res } : r)),
        (err) => { console.error(`Bulk upload error for ${row.fileName}:`, err); setBulkRows((prev) => prev.map((r) => r.caseId === row.caseId ? { ...r, isUploading: false, uploadProgress: 0 } : r)); }
      );
    });
  };

  const updateBulkRow = (i: number, patch: Partial<BulkRow>) =>
    setBulkRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeBulkRow = (i: number) => setBulkRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleBulkSubmit = async () => {
    if (bulkRows.length === 0) return;
    if (bulkRows.some((row) => !hasAllRequiredCaseFields(row.category, row.subTypeData, row.notes, row.teeth, row.uploadedFile))) {
      toast.error("Complete all fields, teeth selection, and file upload for every case.");
      return;
    }
    const formData = new FormData();
    formData.append("cases", JSON.stringify(
      bulkRows.map((row) => ({
        category: row.category,
        subTypeData: { ...row.subTypeData, modelRequired: row.modelRequired, teeth: row.teeth, toothSystem: row.toothSystem, notes: row.notes },
        caseNumber: row.caseId,
        uploadedFile: row.uploadedFile,
      }))
    ));
    try {
      const res = await fetch("/api/cases", { method: "POST", body: formData });
      if (res.ok) {
        toast.success("Cases submitted successfully!");
        setBulkRows([]);
        if (bulkFileRef.current) bulkFileRef.current.value = "";
        setUploadOpen(false);
        fetchCases();
      } else {
        toast.error("Failed to submit bulk cases.");
      }
    } catch (error) {
      toast.error("An error occurred during submission.");
      console.error("Bulk submit error:", error);
    }
  };

  return (
    <OpsLayout>
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">Cases</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">{cases.length} lifetime cases · {filtered.length} shown</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs font-semibold"><Download className="h-3.5 w-3.5 mr-1.5" /> Export Excel</Button>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 text-xs font-semibold"><Plus className="h-3.5 w-3.5 mr-1.5" />Add New Case</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Submit New Case</DialogTitle></DialogHeader>
                <Tabs defaultValue="single" className="mt-2">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="single">Single Case</TabsTrigger>
                    <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
                  </TabsList>

                  <TabsContent value="single" className="space-y-5 mt-4">
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
                            <p className="text-sm font-medium text-foreground">Uploading... {uploadProgress}%</p>
                            <div className="w-full bg-muted rounded-full h-1.5 max-w-xs mx-auto">
                              <div className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                            </div>
                          </div>
                        </div>
                      ) : uploadedFileUrl ? (
                        <div className="flex items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg shadow-sm">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 bg-emerald-500/20 text-emerald-600 rounded-md shrink-0">
                              <FileBox className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate max-w-[280px] lg:max-w-[400px]">
                                {singleFile?.name}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-xs text-muted-foreground">
                                  ({singleFile ? (singleFile.size / 1024 / 1024).toFixed(2) : 0} MB)
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
                                  await handleDeleteUploadedFile(uploadedFile.fileName);
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
                        <label className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors block border-border hover:border-emerald-800">
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
                            <p className="text-sm font-medium text-foreground">Drop file here or click to upload</p>
                            <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, MP4, PDF, ZIP, DOC, DOCX, TXT (Max 2GB)</p>
                          </div>
                        </label>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Select value={category} onValueChange={(v) => { setCategory(v); setSubTypeData({}); }}>
                          <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-emerald-800 text-white">
                            {Object.keys(CASE_HIERARCHY).map((cat) => (<SelectItem key={cat} value={cat} className="focus:bg-emerald-700 focus:text-white">{cat}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Model Required?</Label>
                        <RadioGroup value={modelRequired} onValueChange={setModelRequired} className="flex gap-6 pt-2">
                          <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="m-yes" /><Label htmlFor="m-yes" className="font-normal">Yes</Label></div>
                          <div className="flex items-center gap-2"><RadioGroupItem value="no" id="m-no" /><Label htmlFor="m-no" className="font-normal">No</Label></div>
                        </RadioGroup>
                      </div>
                    </div>

                    {CASE_HIERARCHY[category as keyof typeof CASE_HIERARCHY]?.fields.map((field) => (
                      <div className="space-y-2" key={field.name}>
                        <Label>{field.label}</Label>
                        <Select value={subTypeData[field.name] || ""} onValueChange={(v) => setSubTypeData({ ...subTypeData, [field.name]: v })}>
                          <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
                          <SelectContent className="bg-emerald-800 text-white">
                            {field.options.map((opt) => (<SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white">{opt}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}

                    <div className="space-y-2">
                      <Label>Tooth Selection ({toothSystem === "USA" ? "Universal Numbering System" : "FDI Numbering System"})</Label>
                      <ToothChart selected={teeth} onChange={setTeeth} system={toothSystem} onChangeSystem={setToothSystem} />
                    </div>
                    <div className="space-y-2">
                      <Label>Additional Notes</Label>
                      <Textarea placeholder="Special instructions, shade reference, occlusion notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                    <Button className="w-full bg-emerald-800 text-white hover:bg-emerald-900" onClick={handleSubmit}>Submit Case</Button>
                  </TabsContent>

                  <TabsContent value="bulk" className="space-y-4 mt-4">
                    {bulkRows.length === 0 ? (
                      <label className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors block">
                        <input ref={bulkFileRef} type="file" multiple className="hidden" onChange={(e) => onBulkFiles(e.target.files)} />
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm font-medium text-foreground">Select up to 10 case files</p>
                        <p className="text-xs text-muted-foreground mt-1">PNG, JPG, MP4, PDF, ZIP, DOC, DOCX, TXT — one row per file (Max 2GB)</p>
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
                              handleBulkRowFileReplace(replacingBulkRowIndex, file);
                              setReplacingBulkRowIndex(null);
                            }
                          }}
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">{bulkRows.length} cases ready</p>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setBulkRows([])}>Clear</Button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {bulkRows.map((row, i) => (
                            <Card key={i} className="shadow-sm">
                              <CardContent className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                    <FileBox className="h-4 w-4 text-emerald-600 shrink-0" />
                                    <p className="text-sm font-medium text-foreground truncate">{row.fileName}</p>
                                    {row.uploadedUrl && <span className="text-emerald-600 text-xs flex items-center font-semibold ml-1">✓ Uploaded</span>}
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
                                        setTimeout(() => bulkRowFileRef.current?.click(), 50);
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
                                          await handleDeleteUploadedFile(row.uploadedFile.fileName);
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
                                    <div className="w-full bg-muted rounded-full h-1"><div className="bg-emerald-600 h-1 rounded-full transition-all duration-300" style={{ width: `${row.uploadProgress}%` }} /></div>
                                    <p className="text-[10px] text-muted-foreground text-right">Uploading... {row.uploadProgress}%</p>
                                  </div>
                                )}
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Category</Label>
                                    <Select value={row.category} onValueChange={(v) => updateBulkRow(i, { category: v, subTypeData: {} })}>
                                      <SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue /></SelectTrigger>
                                      <SelectContent className="bg-emerald-800 text-white">
                                        {Object.keys(CASE_HIERARCHY).map((cat) => (<SelectItem key={cat} value={cat} className="focus:bg-emerald-700 focus:text-white">{cat}</SelectItem>))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Model Required?</Label>
                                    <RadioGroup value={row.modelRequired} onValueChange={(v) => updateBulkRow(i, { modelRequired: v as "yes" | "no" })} className="flex gap-4 items-center pt-1">
                                      <div className="flex items-center gap-1.5"><RadioGroupItem value="yes" id={`bm-yes-${i}`} /><Label htmlFor={`bm-yes-${i}`} className="text-xs">Yes</Label></div>
                                      <div className="flex items-center gap-1.5"><RadioGroupItem value="no" id={`bm-no-${i}`} /><Label htmlFor={`bm-no-${i}`} className="text-xs">No</Label></div>
                                    </RadioGroup>
                                  </div>
                                </div>
                                {CASE_HIERARCHY[row.category as keyof typeof CASE_HIERARCHY]?.fields.map((field) => (
                                  <div className="space-y-1" key={field.name}>
                                    <Label className="text-xs">{field.label}</Label>
                                    <Select value={row.subTypeData[field.name] || ""} onValueChange={(v) => updateBulkRow(i, { subTypeData: { ...row.subTypeData, [field.name]: v } })}>
                                      <SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
                                      <SelectContent className="bg-emerald-800 text-white">
                                        {field.options.map((opt) => (<SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white">{opt}</SelectItem>))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ))}
                                <ToothChart selected={row.teeth} onChange={(t) => updateBulkRow(i, { teeth: t })} system={row.toothSystem} onChangeSystem={(sys) => updateBulkRow(i, { toothSystem: sys })} />
                                <Textarea value={row.notes} onChange={(e) => updateBulkRow(i, { notes: e.target.value })} placeholder="Notes for this case…" className="min-h-[60px]" />
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                        <Button className="w-full" onClick={handleBulkSubmit}>Submit All Cases</Button>
                      </>
                    )}
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filters */}
        <Card className="shadow-card border-border/50">
          <CardContent className="p-3 space-y-2.5">
            <div className="flex flex-col lg:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8 h-8 text-xs" placeholder="Search cases..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v)}>
                <SelectTrigger className="w-full lg:w-48 h-8 text-xs"><SelectValue placeholder="Case type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Case Types</SelectItem>
                  {Object.keys(CASE_HIERARCHY).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full lg:w-36 h-8 text-xs" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full lg:w-36 h-8 text-xs" />
              <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => { setSearch(""); setTypeFilter("All"); setStatusFilter("All"); setFrom(""); setTo(""); }}>Clear</Button>
            </div>
            <div className="flex gap-1 flex-wrap pt-0.5">
              {statusFilters.map((s) => (
                <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-[10px] font-bold uppercase tracking-wider" onClick={() => setStatusFilter(s)}>{s}</Button>
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
                    {["Case ID", "Type", "Case Sub Type", "Teeth", "Status", "Designer", "CreatedAt", "Actions"].map((h) => (
                      <th key={h} className="text-left text-[10px] font-bold text-muted-foreground px-3.5 py-2 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <tr key={idx} className="animate-pulse">
                        {Array.from({ length: 8 }).map((__, col) => (
                          <td key={col} className="px-3.5 py-2"><div className="h-3 bg-muted rounded w-16" /></td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    filtered.map((c) => {
                      const toothNumbers = c.subTypeData?.teeth || [];
                      const toothSys = c.subTypeData?.toothSystem || "USA";
                      const restoration = c.subTypeData
                        ? Object.entries(c.subTypeData)
                          .filter(([k, v]) => k !== "teeth" && k !== "toothSystem" && k !== "notes" && k !== "modelRequired" && typeof v === "string" && v)
                          .map(([, v]) => v).join(" - ")
                        : c.category || "—";
                      const createdAtFormatted = c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "—";

                      const isMutating = updatingId === c.id;

                      /**
                       * ROLE FLAGS
                       * ──────────────────────────────────────────────────────
                       * isAdmin        — user is an admin
                       * isDesigner     — user role is designer
                       * isQc           — user role is qc
                       *
                       * isDesignerOnCase — this user is the assigned designer
                       * isQcOnCase       — this user is the assigned QC
                       *
                       * canActAsDesigner — true for designers always, and for QC
                       *                   members when they are the assigned designer
                       *                   on this specific case (dual-role).
                       *
                       * canDoQcActions  — true only for QC members who ARE the
                       *                   assigned QC on this case AND are NOT
                       *                   simultaneously the designer (prevents
                       *                   self-review).
                       */
                      const isAdmin = activeUserRole === "admin";
                      const isDesigner = activeUserRole === "designer";
                      const isQc = activeUserRole === "qc";

                      const isDesignerOnCase = c.designerId === activeUserId;
                      const isQcOnCase = c.qcId === activeUserId;

                      // A QC can act as designer on the case if they are
                      // the assigned designer (dual-role support).
                      const canActAsDesigner = isDesigner || (isQc && isDesignerOnCase);

                      // QC review actions are blocked if the QC is also
                      // the designer on this case (no self-review).
                      const canDoQcActions = isQc && isQcOnCase && !isDesignerOnCase;
                      const hasUnreadChat = Boolean(c.hasUnreadChat);

                      return (
                        <tr
                          key={c.id}
                          className={`hover:bg-muted/10 cursor-pointer transition-colors border-l-2 ${c.status === "submitted_to_client" ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.08] border-l-amber-500 font-medium" : "border-l-transparent"}`}
                          onClick={() => router.push(`/cases/${c.id}`)}
                        >
                          <td className="px-3.5 py-1.5 text-[11px] font-bold text-primary">
                            <div className="flex items-center gap-1.5">
                              <span>{c.caseNumber || c.id}</span>
                              {shouldShowChatIcon(c, currentUser) && (hasUnreadChat || (c.todayMessagesCount || 0) > 0) && (
                                <span className="relative inline-flex items-center shrink-0" title={hasUnreadChat ? "New Messages" : `${c.todayMessagesCount} messages today`}>
                                  <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${hasUnreadChat ? "text-emerald-500" : "text-slate-400"}`} />
                                  {hasUnreadChat ? (
                                    <span className="absolute -top-1 -right-1.5 flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                    </span>
                                  ) : (
                                    <span className="absolute -top-1 -right-1.5 min-w-3 h-3 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-bold border border-white leading-none">
                                      {c.todayMessagesCount}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{c.category}</td>
                          <td className="px-3.5 py-1.5 text-[11px] text-foreground font-semibold">{restoration || "—"}</td>
                          <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground">{toothNumbers.length ? `#${toothNumbers.join(", #")} (${toothSys === "USA" ? "Universal" : toothSys})` : "—"}</td>
                          <td className="px-3.5 py-1.5"><StatusBadge status={c.status} role="internal" /></td>
                          <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{c.designerName || "—"}</td>
                          <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{createdAtFormatted}</td>
                          <td className="px-3.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1.5 items-center flex-wrap">

                              {/* ── ADMIN BLOCK ─────────────────────────────── */}
                              {isAdmin && (
                                <>
                                  {c.status === "scan_received" && (
                                    <>
                                      <Button size="sm" variant="outline" disabled={isMutating}
                                        onClick={() => handleUpdate(c.id, { status: "scan_verified" }, "Scan validated · ready for allocation")}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm">
                                        <ShieldCheck className="h-3 w-3 mr-1" />Validate
                                      </Button>
                                      <AllocateMenu designers={designers} disabled={isMutating} onPick={(dId) => handleUpdate(c.id, { designerId: dId, status: "allocated_to_designer" }, "Allocated case to designer")} />
                                    </>
                                  )}
                                  {(c.status === "scan_verified" || c.status === "scan_not_verified") && (
                                    <AllocateMenu designers={designers} disabled={isMutating} onPick={(dId) => handleUpdate(c.id, { designerId: dId, status: "allocated_to_designer" }, "Allocated case to designer")} />
                                  )}
                                  {(c.status === "allocated_to_designer" || c.status === "in_progress") && (
                                    !c.designerId ? (
                                      <AllocateMenu designers={designers} disabled={isMutating} onPick={(dId) => handleUpdate(c.id, { designerId: dId, status: "allocated_to_designer" }, "Allocated case to designer")} />
                                    ) : (
                                      !c.qcId ? (
                                        <Button size="sm" variant="outline" disabled={isMutating} onClick={() => setAssignQcCaseId(c.id)}
                                          className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm">
                                          <UserPlus className="h-3 w-3 mr-1" /> Assign QC
                                        </Button>
                                      ) : (
                                        <Button size="sm" variant="outline" disabled={isMutating}
                                          onClick={() => handleUpdate(c.id, { status: "internal_qc" }, "Submitted case to Internal QC")}
                                          className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-primary border-primary/50 text-white hover:bg-zinc-800">
                                          <ClipboardCheck className="h-3 w-3 mr-1" /> Send to QC
                                        </Button>
                                      )
                                    )
                                  )}
                                  {c.status === "internal_qc" && (
                                    <div className="flex flex-wrap gap-1 items-center">
                                      <Button size="sm" disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(c.id, "approve", c.caseNumber); }}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">✓ Approve</Button>
                                      <Button size="sm" variant="destructive" disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(c.id, "reject", c.caseNumber); }}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-red-600 hover:bg-red-700 shadow-sm">✗ Reject</Button>
                                      <Button size="sm" disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(c.id, "feedback", c.caseNumber); }}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-amber-500 hover:bg-amber-600 text-white shadow-sm">💬 Feedback</Button>
                                      <Button size="sm" disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(c.id, "hold", c.caseNumber); }}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-gray-500 hover:bg-gray-600 text-white shadow-sm">⏸ Hold</Button>
                                    </div>
                                  )}
                                  {c.status === "client_feedback" && (
                                    <Button size="sm" variant="outline" disabled={isMutating}
                                      onClick={() => handleUpdate(c.id, { status: "in_progress" }, "Sent case back to design")}
                                      className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">Back to designer</Button>
                                  )}
                                  {c.status === "on_hold" && (
                                    <Button size="sm" disabled={isMutating}
                                      onClick={() => handleUpdate(c.id, { status: "scan_received" }, "Case resumed to active queue")}
                                      className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                                      <RefreshCw className="h-3 w-3 mr-1" /> Resume Case
                                    </Button>
                                  )}
                                </>
                              )}

                              {/* ── QC BLOCK ────────────────────────────────── */}
                              {/*
                               * QC has two possible roles on a case:
                               *   1. Acting as DESIGNER — when qcId+designerId both point to them
                               *      → handled in the DESIGNER BLOCK below via canActAsDesigner
                               *   2. Acting as QC REVIEWER — when only qcId points to them
                               *      → handled here, and blocked if they are also the designer
                               *
                               * Shared QC actions regardless of case assignment:
                               *   - Validate scan
                               *   - Self-allocate as designer (if no designer yet)
                               *   - Self-assign as QC (if no QC yet)
                               */}
                              {isQc && (
                                <>
                                  {/* Validate scan */}
                                  {c.status === "scan_received" && (
                                    <Button size="sm" variant="outline" disabled={isMutating}
                                      onClick={() => handleUpdate(c.id, { status: "scan_verified" }, "Scan validated · ready for allocation")}
                                      className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm">
                                      <ShieldCheck className="h-3 w-3 mr-1" /> Validate
                                    </Button>
                                  )}

                                  {/* Self-allocate as designer when no designer is assigned */}
                                  {!c.designerId && (c.status === "scan_received" || c.status === "scan_verified") && (
                                    <Button size="sm" disabled={isMutating}
                                      onClick={() => handleUpdate(c.id, { designerId: activeUserId, status: "allocated_to_designer" }, "Allocated case to yourself as designer")}
                                      className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                                      <UserPlus className="h-3 w-3 mr-1" /> Take as Designer
                                    </Button>
                                  )}

                                  {/* Self-assign as QC when no QC is assigned yet */}
                                  {!c.qcId && (c.status === "allocated_to_designer" || c.status === "in_progress" || c.status === "internal_qc") && (
                                    <Button size="sm" variant="outline" disabled={isMutating}
                                      onClick={() => handleUpdate(c.id, { qcId: activeUserId }, "Assigned yourself as QC")}
                                      className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm">
                                      <UserPlus className="h-3 w-3 mr-1" /> Assign QC to Self
                                    </Button>
                                  )}

                                  {/* QC review actions — only when assigned as QC AND not also the designer */}
                                  {canDoQcActions && c.status === "internal_qc" && (
                                    <div className="flex flex-wrap gap-1 items-center">
                                      <Button size="sm" disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(c.id, "approve", c.caseNumber); }}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">✓ Approve</Button>
                                      <Button size="sm" variant="destructive" disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(c.id, "reject", c.caseNumber); }}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-red-600 hover:bg-red-700 shadow-sm">✗ Reject</Button>
                                      <Button size="sm" disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(c.id, "feedback", c.caseNumber); }}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-amber-500 hover:bg-amber-600 text-white shadow-sm">💬 Feedback</Button>
                                      <Button size="sm" disabled={isMutating || !!pendingCaseAction}
                                        onClick={(e) => { e.stopPropagation(); openCaseActionDialog(c.id, "hold", c.caseNumber); }}
                                        className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-gray-500 hover:bg-gray-600 text-white shadow-sm">⏸ Hold</Button>
                                    </div>
                                  )}

                                  {/* Inform QC that they cannot self-review */}
                                  {isQcOnCase && isDesignerOnCase && c.status === "internal_qc" && (
                                    <span className="text-[11px] text-amber-600 italic px-1">Self-review blocked</span>
                                  )}
                                  {c.status === "on_hold" && (c.qcId === activeUserId || c.designerId === activeUserId) && (
                                    <Button size="sm" disabled={isMutating}
                                      onClick={() => handleUpdate(c.id, { status: "scan_received" }, "Case resumed to active queue")}
                                      className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                                      <RefreshCw className="h-3 w-3 mr-1" /> Resume Case
                                    </Button>
                                  )}
                                </>
                              )}

                              {/* ── DESIGNER BLOCK ──────────────────────────── */}
                              {/*
                               * canActAsDesigner is true for:
                               *   - role === "designer" (always)
                               *   - role === "qc" AND they are the designated designerId on this case
                               *
                               * This block handles all design-side workflow:
                               *   validate → self-allocate → start work → upload design → assign QC → send to QC
                               */}
                              {canActAsDesigner && (
                                <>
                                  {/* Validate: designer can validate unverified scans they intend to pick up */}
                                  {isDesigner && !c.designerId && c.status === "scan_received" && (
                                    <Button size="sm" disabled={isMutating}
                                      onClick={() => handleUpdate(c.id, { status: "scan_verified" }, "Scan validated · ready for allocation")}
                                      className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                                      <ShieldCheck className="h-3 w-3 mr-1" /> Validate
                                    </Button>
                                  )}

                                  {/* Self-allocate as designer (designer role only; QC has its own "Take as Designer" above) */}
                                  {isDesigner && !c.designerId && (c.status === "scan_received" || c.status === "scan_verified") && (
                                    <Button size="sm" disabled={isMutating}
                                      onClick={() => handleUpdate(c.id, { designerId: activeUserId, status: "allocated_to_designer" }, "Allocated case to yourself")}
                                      className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                                      <UserPlus className="h-3 w-3 mr-1" /> Allocate to Self
                                    </Button>
                                  )}

                                  {isDesignerOnCase && (
                                    <>
                                      {c.status === "on_hold" && (
                                        <Button size="sm" disabled={isMutating}
                                          onClick={() => handleUpdate(c.id, { status: "scan_received" }, "Case resumed to active queue")}
                                          className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                                          <RefreshCw className="h-3 w-3 mr-1" /> Resume Case
                                        </Button>
                                      )}
                                      {c.status === "allocated_to_designer" && (
                                        <div className="flex gap-1.5 flex-wrap">
                                          <Button size="sm" disabled={isMutating}
                                            onClick={() => handleUpdate(c.id, { status: "in_progress" }, "Started design work")}
                                            className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
                                            Start Work
                                          </Button>
                                          <Button size="sm" variant="outline" disabled={isMutating}
                                            onClick={(e) => { e.stopPropagation(); openDesignUploadDialog(c.id, c.caseNumber, c.clientId); }}
                                            className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-primary border-primary/50 text-white hover:bg-zinc-800">
                                            <Upload className="h-3 w-3 mr-1" /> Upload Design
                                          </Button>
                                          {!c.qcId && (
                                            <Button size="sm" variant="outline" disabled={isMutating}
                                              onClick={() => setAssignQcCaseId(c.id)}
                                              className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm">
                                              <UserPlus className="h-3 w-3 mr-1" /> Assign QC
                                            </Button>
                                          )}
                                        </div>
                                      )}

                                      {c.status === "in_progress" && (
                                        <div className="flex gap-1.5 flex-wrap">
                                          <Button size="sm" variant="outline" disabled={isMutating}
                                            onClick={(e) => { e.stopPropagation(); openDesignUploadDialog(c.id, c.caseNumber, c.clientId); }}
                                            className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-primary border-primary/50 text-white hover:bg-zinc-800">
                                            <Upload className="h-3 w-3 mr-1" /> Upload Design
                                          </Button>
                                          {!c.qcId ? (
                                            <Button size="sm" variant="outline" disabled={isMutating}
                                              onClick={() => setAssignQcCaseId(c.id)}
                                              className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm">
                                              <UserPlus className="h-3 w-3 mr-1" /> Assign QC
                                            </Button>
                                          ) : (
                                            <Button size="sm" variant="outline" disabled={isMutating}
                                              onClick={() => handleUpdate(c.id, { status: "internal_qc" }, "Submitted case to Internal QC")}
                                              className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-primary border-primary/50 text-white hover:bg-zinc-800">
                                              <ClipboardCheck className="h-3 w-3 mr-1" /> Send to QC
                                            </Button>
                                          )}
                                        </div>
                                      )}

                                      {c.status === "internal_qc" && (
                                        <span className="text-[11px] text-amber-600 italic px-1">In QC Review</span>
                                      )}

                                      {c.status === "client_feedback" && (
                                        <Button size="sm" disabled={isMutating}
                                          onClick={() => handleUpdate(c.id, { status: "in_progress" }, "Restarted design to apply feedback")}
                                          className="h-7 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
                                          Apply Feedback
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </>
                              )}

                              {/* Read-only states visible to any assigned member */}
                              {c.status === "submitted_to_client" && (isDesignerOnCase || isQcOnCase || isAdmin) && (
                                <span className="text-[11px] text-muted-foreground italic px-1">awaiting client…</span>
                              )}
                              {(c.status === "approved" || c.status === "delivered") && (isDesignerOnCase || isQcOnCase || isAdmin) && (
                                <span className="text-[11px] text-green-600 font-semibold px-1">Completed</span>
                              )}

                              {activeUser && !["admin", "qc", "designer"].includes(activeUserRole) && (
                                <span className="text-[11px] text-muted-foreground italic">Read-only</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <tr><td colSpan={8} className="px-3.5 py-6 text-center text-xs text-muted-foreground">No cases match your filters</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Case Action Dialog (reject / feedback / hold) */}
      <Dialog open={!!pendingCaseAction} onOpenChange={(open) => { if (!open) closeCaseActionDialog(); }}>
        <DialogContent className="sm:max-w-[560px] bg-primary border-primary/50 text-white shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
              {pendingCaseAction ? CASE_ACTIONS[pendingCaseAction.action].title : "Case Action"}
            </DialogTitle>
            <p className="text-xs text-zinc-300">
              {pendingCaseAction ? CASE_ACTIONS[pendingCaseAction.action].description : ""}
              {pendingCaseAction?.caseNumber ? ` Case ${pendingCaseAction.caseNumber}.` : ""}
            </p>
          </DialogHeader>
          {pendingCaseAction?.action === "approve" && (
            <div className="grid gap-2.5 py-3 border-t border-b border-white/10">
              <p className="text-xs font-semibold text-zinc-300">
                Quality Checklist
              </p>
              <div className="grid gap-2">
                {QC_CHECKLIST.map((item) => {
                  const itemId = `qc-approve-check-${item.replace(/\s+/g, "-").toLowerCase()}`
                  return (
                    <label
                      key={item}
                      htmlFor={itemId}
                      className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                    >
                      <input
                        id={itemId}
                        type="checkbox"
                        checked={!!approveChecklist[item]}
                        onChange={(e) =>
                          setApproveChecklist((current) => ({
                            ...current,
                            [item]: e.target.checked,
                          }))
                        }
                        className="mt-0.5 h-4 w-4 rounded border-white/30 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span className="text-xs font-medium leading-5">{item}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          {pendingCaseAction && CASE_ACTIONS[pendingCaseAction.action].reasonKey && (
            <div className="grid gap-3 py-4">
              <Label htmlFor="case-action-reason" className="text-sm font-semibold text-zinc-200">
                {CASE_ACTIONS[pendingCaseAction.action].reasonLabel}
              </Label>
              {pendingCaseAction.action === "hold" ? (
                <div className="space-y-3">
                  <Select value={holdReasonSelect} onValueChange={setHoldReasonSelect}>
                    <SelectTrigger className="w-full bg-primary/80 border-primary-50/50 text-white focus:ring-emerald-500">
                      <SelectValue placeholder="Select a hold reason..." />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-950 border border-zinc-800 text-white shadow-2xl">
                      {HOLD_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason} className="hover:bg-zinc-800 focus:bg-zinc-800 cursor-pointer">
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {holdReasonSelect === "Other (please specify)" && (
                    <Textarea
                      id="case-action-reason"
                      value={caseActionReason}
                      onChange={(e) => setCaseActionReason(e.target.value)}
                      placeholder="Please specify other hold reason details..."
                      className="min-h-[100px] bg-primary/80 border-primary-50/50 text-white placeholder:text-zinc-400 focus-visible:ring-emerald-500"
                    />
                  )}
                </div>
              ) : (
                <Textarea
                  id="case-action-reason"
                  value={caseActionReason}
                  onChange={(e) => setCaseActionReason(e.target.value)}
                  placeholder={`Add ${CASE_ACTIONS[pendingCaseAction.action].reasonLabel?.toLowerCase()}`}
                  className="min-h-[120px] bg-primary/80 border-primary-50/50 text-white placeholder:text-zinc-400 focus-visible:ring-emerald-500"
                />
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={closeCaseActionDialog} className="text-white hover:bg-zinc-800"
              disabled={updatingId === pendingCaseAction?.caseId}>Cancel</Button>
            <Button
              disabled={
                updatingId === pendingCaseAction?.caseId ||
                (pendingCaseAction
                  ? pendingCaseAction.action === "hold"
                    ? !holdReasonSelect || (holdReasonSelect === "Other (please specify)" && !caseActionReason.trim())
                    : pendingCaseAction.action === "approve"
                      ? !QC_CHECKLIST.every((item) => approveChecklist[item])
                      : Boolean(CASE_ACTIONS[pendingCaseAction.action].reasonKey && !caseActionReason.trim())
                  : true)
              }
              onClick={confirmCaseAction}
              className={
                pendingCaseAction?.action === "reject" ? "bg-red-600 hover:bg-red-700 text-white font-semibold"
                  : pendingCaseAction?.action === "hold" ? "bg-gray-600 hover:bg-gray-700 text-white font-semibold"
                    : pendingCaseAction?.action === "feedback" ? "bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              }>
              {pendingCaseAction ? CASE_ACTIONS[pendingCaseAction.action].confirmLabel : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Design Upload Dialog */}
      <Dialog open={!!designUploadCaseId} onOpenChange={(open) => { if (!open) closeDesignUploadDialog(); }}>
        <DialogContent className="sm:max-w-[520px] bg-white border-gray-200 text-black shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium text-black flex items-center gap-2">
              <Upload className="h-5 w-5 text-emerald-500" /> Upload Design
            </DialogTitle>
            <p className="text-xs text-gray-700">
              Add the design notes and upload the case design file{designUploadCaseNumber ? ` for case ${designUploadCaseNumber}.` : "."}
            </p>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="design-note" className="text-sm font-semibold text-gray-700">Case Note</Label>
              <Textarea id="design-note" value={designUploadNote} onChange={(e) => setDesignUploadNote(e.target.value)}
                placeholder="Add case design notes..."
                className="min-h-[120px] bg-gray-100 border-gray-200 text-gray-900 placeholder:text-zinc-400 focus-visible:ring-emerald-500" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="design-file" className="text-sm font-semibold text-gray-700">Case File</Label>
              <Input id="design-file" ref={designUploadInputRef} type="file"
                onChange={(e) => setDesignUploadFile(e.target.files?.[0] || null)}
                className="bg-gray-100 border-gray-200 text-gray-900 file:text-white file:bg-emerald-600 file:border-none file:rounded-md file:px-3 file:py-2" />
              {designUploadFile && <p className="text-xs text-gray-900">Selected: {designUploadFile.name}</p>}
            </div>
            <div className="grid gap-2 mt-1">
              <Label htmlFor="preview-file" className="text-sm font-semibold text-gray-700">Preview File (HTML Only - Optional)</Label>
              <Input id="preview-file" ref={previewUploadInputRef} type="file" accept=".html,.htm"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file) {
                    const check = validateHtmlFile(file);
                    if (!check.isValid) {
                      toast.error(check.error || "Only HTML files are allowed");
                      if (previewUploadInputRef.current) previewUploadInputRef.current.value = "";
                      setDesignUploadPreviewFile(null);
                    } else {
                      setDesignUploadPreviewFile(file);
                    }
                  } else {
                    setDesignUploadPreviewFile(null);
                  }
                }}
                className="bg-gray-100 border-gray-200 text-gray-900 file:text-white file:bg-indigo-600 file:border-none file:rounded-md file:px-3 file:py-2" />
              {designUploadPreviewFile && <p className="text-xs text-gray-900">Selected HTML: {designUploadPreviewFile.name}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={closeDesignUploadDialog} className="text-gray-700 hover:bg-zinc-100 hover:text-black" disabled={isDesignUploading}>Cancel</Button>
            <Button disabled={isDesignUploading} onClick={confirmDesignUpload} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              {isDesignUploading ? "Uploading..." : "Confirm Upload"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign QC Dialog */}
      <Dialog open={!!assignQcCaseId} onOpenChange={(o) => { if (!o) { setAssignQcCaseId(null); setSelectedQcId(""); } }}>
        <DialogContent className="sm:max-w-[425px] bg-primary border-primary/50 text-white shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" /> Assign QC Lead
            </DialogTitle>
            <p className="text-xs text-zinc-300">Select an active Quality Control team member to allocate to this case.</p>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="qc-select" className="text-sm font-semibold text-zinc-200">QC Member</label>
              <Select value={selectedQcId} onValueChange={setSelectedQcId}>
                <SelectTrigger id="qc-select" className="bg-primary/80 border-primary-50/50 text-white">
                  <SelectValue placeholder="Select QC Lead" />
                </SelectTrigger>
                <SelectContent className="bg-primary border-primary-50/50 text-white">
                  {qcs.map((qc) => (
                    <SelectItem key={qc.id} value={qc.id} className="text-white focus:bg-emerald-600 focus:text-white cursor-pointer">
                      {qc.fullName || qc.email}
                    </SelectItem>
                  ))}
                  {qcs.length === 0 && <p className="text-xs p-2 text-zinc-400">No active QC leads found.</p>}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => { setAssignQcCaseId(null); setSelectedQcId(""); }} className="text-white hover:bg-zinc-800">Cancel</Button>
            <Button disabled={!selectedQcId || updatingId === assignQcCaseId}
              onClick={async () => {
                if (!assignQcCaseId || !selectedQcId) return;
                await handleUpdate(assignQcCaseId, { qcId: selectedQcId }, "Successfully assigned QC lead");
                setAssignQcCaseId(null);
                setSelectedQcId("");
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              Assign QC
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </OpsLayout>
  );
}

function AllocateMenu({ designers, onPick, disabled }: { designers: OpsMember[]; onPick: (designerId: string) => void; disabled?: boolean }) {
  return (
    <Select onValueChange={onPick} disabled={disabled}>
      <SelectTrigger className="h-8 text-xs w-[160px] border-border/80 bg-white">
        <span className="flex items-center text-zinc-800">
          <UserPlus className="h-3.5 w-3.5 mr-1" /> Allocate
        </span>
      </SelectTrigger>
      <SelectContent className="bg-primary border-primary/50 text-white">
        {designers.map((d) => (
          <SelectItem key={d.id} value={d.id} className="bg-primary text-white focus:bg-emerald-600 focus:text-white cursor-pointer">
            {d.fullName || d.email}
          </SelectItem>
        ))}
        {designers.length === 0 && (
          <SelectItem value="none" disabled className="bg-primary text-white/50 cursor-not-allowed">
            No active designers
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
