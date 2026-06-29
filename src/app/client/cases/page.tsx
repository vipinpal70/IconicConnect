/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
"use client"

import { useMemo, useState, useRef, useEffect } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { ClientLayout } from "@/src/components/ClientLayout";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { StatusBadge } from "@/src/components/StatusBadge";
import { ToothChart } from "@/src/components/ToothChart";
import { type CaseStatus } from "@/src/data/demoData";
import { Plus, Search, Download, Upload, X, FileArchive, RefreshCw, MessageSquare, Loader2 } from "lucide-react";
import { downloadCSV, extractCaseTeethInfo } from "@/src/lib/export-csv";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Label } from "@/src/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
import { toast } from "sonner";
import { uploadFileInChunks } from "@/src/lib/upload-utils";

interface BulkRow {
  fileName: string;
  file: File;
  category: string;
  subTypeData: Record<string, any>;
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

const uploadFileWithXHR = async (
  file: File,
  labName: string,
  onProgress: (progress: number) => void,
  onSuccess: (res: { fileUrl: string; fileName: string; fileSize: number; fileType: string }) => void,
  onError: (err: string) => void
) => {
  await uploadFileInChunks(
    file,
    {},
    onProgress,
    onSuccess,
    onError
  );
};

const validateFile = (file: File): { isValid: boolean; error?: string } => {
  const maxLimit = 2 * 1024 * 1024 * 1024; // 2GB
  if (file.size > maxLimit) {
    return { isValid: false, error: `File size exceeds the 2GB limit. Size: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB` };
  }

  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const allowedExtensions = [
    '.png', '.jpg', '.jpeg',
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.3gp', '.mpeg', '.mpg',
    '.pdf',
    '.zip',
    '.doc', '.docx',
    '.txt',
    '.html', '.htm'
  ];

  if (!allowedExtensions.includes(ext)) {
    return { isValid: false, error: `File type "${ext}" is not supported. Allowed formats: PNG, JPG, JPEG, MP4/video, PDF, ZIP, DOC, DOCX, TXT, HTML` };
  }

  return { isValid: true };
};

const validateTeethLibraryFile = (file: File): { isValid: boolean; error?: string } => {
  const maxLimit = 2 * 1024 * 1024 * 1024; // 2GB
  if (file.size > maxLimit) {
    return { isValid: false, error: `Teeth library file size exceeds the 2GB limit. Size: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB` };
  }

  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const allowedExtensions = ['.dme', '.zip'];

  if (!allowedExtensions.includes(ext)) {
    return { isValid: false, error: `File type "${ext}" is not supported. Only .dme or .zip files are allowed for custom teeth libraries.` };
  }

  return { isValid: true };
};

const statusFilters: (CaseStatus | "All")[] = [
  "All", "Submitted", "In Validation", "In Design", "Internal QC",
  "Pending Client Approval", "Feedback", "On Hold", "Completed", "Cancelled",
];

const STATUS_FILTER_MAP: Record<string, string[]> = {
  "Submitted": ["scan_received"],
  "In Validation": ["scan_verified", "scan_not_verified"],
  "In Design": ["allocated_to_designer", "in_progress"],
  "Internal QC": ["internal_qc"],
  "Pending Client Approval": ["submitted_to_client", "change_requested"],
  "Feedback": ["client_feedback"],
  "On Hold": ["on_hold"],
  "Completed": ["approved", "delivered"],
  "Cancelled": ["cancelled"],
};

const hasAllRequiredCaseFields = (
  category: string,
  subTypeData: Record<string, any>,
  notes: string,
  teeth: number[],
  uploadedFile: unknown,
  crownBridgeTeeth?: number[]
) => {
  const fields = CASE_HIERARCHY[category as keyof typeof CASE_HIERARCHY]?.fields || []
  const allDynamicFieldsSelected = fields.every((field: any) => field.optional || Boolean(subTypeData[field.name]))

  let isValid = Boolean(
    category &&
    uploadedFile &&
    allDynamicFieldsSelected &&
    teeth.length > 0
  );

  if (category === "Implant") {
    const cbType = subTypeData.caseType2;
    if (cbType && cbType !== "None") {
      const cbTeeth = crownBridgeTeeth || subTypeData.crownBridgeTeeth;
      isValid = isValid && Boolean(cbTeeth && cbTeeth.length > 0);
    }
  }

  return isValid;
}

const CASE_HIERARCHY = {
  "Crown & Bridges": {
    fields: [
      { name: "caseType", label: "Case Type", type: "select", options: ["Crown", "Bridge", "Cutback", "Coping", "Screw Retained", "In-Lay", "On-Lay"] }
    ]
  },
  "Denture": {
    fields: [
      { name: "caseType1", label: "Case Type 1", type: "select", options: ["Reference Denture", "Copy Denture", "Immediate Denture", "Full Denture", "Partial Denture"] },
      { name: "caseType2", label: "Case Type 2", type: "select", options: ["Lower", "Upper", "Both Arches"] }
    ]
  },
  "Cosmetics": {
    fields: [
      { name: "caseType", label: "Case Type", type: "select", options: ["Digital Wax Up", "Vineers", "Snap on Smile"] }
    ]
  },
  "Appliances": {
    fields: [
      { name: "caseType1", label: "Case Type 1", type: "select", options: ["Night Guards", "Sports Guard", "Mouth Guard", "NTI"] },
      { name: "occlusion", label: "Occlusion", type: "select", options: ["even occlusion", "custom"] },
      { name: "arch", label: "Arch", type: "select", options: ["Lower", "Upper"] }
    ]
  },
  "Implant": {
    fields: [
      { name: "caseType1", label: "Sub Type 1", type: "select", options: ["Robotic", "Custom", "Ti-Base"] },
      { name: "caseType2", label: "Crown & Bridge type", type: "select", options: ["None", "Crown", "Bridge"], optional: true }
    ]
  }
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
    fetchCases();
    const interval = setInterval(() => { void fetchCases(false); }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const [category, setCategory] = useState<string>("Crown & Bridges");
  const [subTypeData, setSubTypeData] = useState<Record<string, any>>({});
  const [modelRequired, setModelRequired] = useState("no");
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

  const [preferredTeethLibrary, setPreferredTeethLibrary] = useState<string>("default");
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
  const [replacingBulkRowIndex, setReplacingBulkRowIndex] = useState<number | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitCooldown, setSubmitCooldown] = useState(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

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
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('labName').eq('id', user.id).single();
        if (profile?.labName) setLabName(profile.labName);
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
        console.error('Immediate upload error:', err);
        setIsUploading(false);
        setUploadProgress(0);
      }
    );
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
        console.error('Library upload error:', err);
        setIsLibraryUploading(false);
        setLibraryUploadProgress(0);
      }
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

  const filtered = useMemo(() => {
    return cases.filter((c) => {
      const s = search.toLowerCase();
      const friendlyId = (c.caseNumber || c.id || "").toLowerCase();
      const friendlyRestoration = (
        c.subTypeData
          ? Object.entries(c.subTypeData)
            .filter(([k, v]) => k !== 'teeth' && k !== 'crownBridgeTeeth' && k !== 'toothSystem' && k !== 'notes' && k !== 'modelRequired' && typeof v === 'string' && v && v.toLowerCase() !== 'none')
            .map(([_, v]) => v)
            .join(" - ")
          : c.category || ""
      ).toLowerCase();

      const matchesSearch =
        !s ||
        friendlyId.includes(s) ||
        friendlyRestoration.includes(s);

      const matchesStatus =
        statusFilter === "All" ||
        (STATUS_FILTER_MAP[statusFilter]?.includes(c.status) ?? false);

      const matchesType = typeFilter === "All" || c.category === typeFilter;

      const createdAtDate = c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : "";
      const matchesFrom = !from || createdAtDate >= from;
      const matchesTo = !to || createdAtDate <= to;

      return matchesSearch && matchesStatus && matchesType && matchesFrom && matchesTo;
    });
  }, [cases, search, statusFilter, typeFilter, from, to]);

  const handleSubmit = async () => {
    if (submitCooldown || isSubmitting) return;

    if (!hasAllRequiredCaseFields(category, subTypeData, notes, teeth, uploadedFile, crownBridgeTeeth)) {
      toast.error("Please complete all fields, select teeth, and upload a file.");
      return;
    }

    if (preferredTeethLibrary === "other" && !uploadedLibraryFile) {
      toast.error("Please upload your custom teeth library file.");
      return;
    }

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
        ...(category === "Implant" && subTypeData.caseType2 !== "None" ? { crownBridgeTeeth } : {}),
      },
      uploadedFile,
      preferredTeethLibrary,
      teethLibraryFileUrl: uploadedLibraryFile?.fileUrl || null,
      teethLibraryFileName: uploadedLibraryFile?.fileName || null,
    };

    formData.append('cases', JSON.stringify(caseData));

    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        toast.success("Case submitted successfully!");
        setUploadOpen(false);
        setNotes("");
        setTeeth([]);
        setCrownBridgeTeeth([]);
        setModelRequired("no");
        setCategory("Crown & Bridges");
        setSubTypeData({});
        setSingleFile(null);
        setUploadedFileUrl(null);
        setUploadedFile(null);
        setPreferredTeethLibrary("default");
        setUploadedLibraryFile(null);
        fetchCases();
      } else {
        toast.error("Failed to submit case.");
        console.error('Failed to submit single case');
      }
    } catch (error) {
      toast.error("An error occurred during submission.");
      console.error('Single submit error:', error);
    } finally {
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
        modelRequired: "no",
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
          setBulkRows((prev) => prev.map((r) => r.caseId === row.caseId ? { ...r, uploadProgress: progress } : r));
        },
        (res) => {
          setBulkRows((prev) => prev.map((r) => r.caseId === row.caseId ? { ...r, uploadProgress: 100, isUploading: false, uploadedUrl: res.fileUrl, uploadedFile: res } : r));
        },
        (err) => {
          console.error(`Immediate bulk upload error for ${row.fileName}:`, err);
          setBulkRows((prev) => prev.map((r) => r.caseId === row.caseId ? { ...r, isUploading: false, uploadProgress: 0 } : r));
        }
      );
    });
  };

  const updateBulkRow = (i: number, patch: Partial<BulkRow>) =>
    setBulkRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeBulkRow = (i: number) =>
    setBulkRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleBulkSubmit = async () => {
    if (submitCooldown || isSubmitting) return;

    if (bulkRows.length === 0) return;

    const hasInvalidRow = bulkRows.some((row) => !hasAllRequiredCaseFields(row.category, row.subTypeData, row.notes, row.teeth, row.uploadedFile))
    if (hasInvalidRow) {
      toast.error("Complete all fields, teeth selection, and file upload for every case.");
      return;
    }

    setIsSubmitting(true);
    setSubmitCooldown(true);
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = setTimeout(() => {
      setSubmitCooldown(false);
    }, 5000);

    const formData = new FormData();

    const casesData = bulkRows.map(row => ({
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

    formData.append('cases', JSON.stringify(casesData));

    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        toast.success("Cases submitted successfully!");
        setBulkRows([]);
        if (bulkFileRef.current) bulkFileRef.current.value = "";
        setUploadOpen(false);
        fetchCases();
      } else {
        toast.error("Failed to submit bulk cases.");
        console.error('Failed to submit bulk cases');
      }
    } catch (error) {
      toast.error("An error occurred during submission.");
      console.error('Bulk submit error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ClientLayout>
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Cases</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{cases.length} lifetime cases · {filtered.length} shown</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                const headers = ["Case Name", "Case #", "Category", "Type / Restoration", "Teeth / Arch Selection", "Unit Count", "Numbering System", "Status", "Due Date", "Created At"]
                const rows = filtered.map((c) => {
                  const restoration = c.subTypeData
                    ? Object.entries(c.subTypeData)
                      .filter(([k, v]) => k !== "teeth" && k !== "crownBridgeTeeth" && k !== "toothSystem" && k !== "notes" && k !== "modelRequired" && typeof v === "string" && v && v.toLowerCase() !== "none")
                      .map(([, v]) => v as string)
                      .join(" - ") || "—"
                    : "—"
                  const teeth = extractCaseTeethInfo(c.category, c.subTypeData as Record<string, unknown>)
                  return [
                    c.scanFileName || "—",
                    c.caseNumber || "—",
                    c.category || "—",
                    restoration,
                    teeth.selection,
                    teeth.unitCount,
                    teeth.numberingSystem,
                    c.status,
                    c.dueDate ? new Date(c.dueDate).toLocaleDateString("en-IN") : "—",
                    c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-IN") : "—",
                  ]
                })
                const date = new Date().toISOString().split("T")[0]
                downloadCSV(headers, rows, `my-cases-${date}.csv`)
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Dialog open={uploadOpen} onOpenChange={(val) => {
              if (isSubmitting || isUploading || isLibraryUploading) return;
              setUploadOpen(val);
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 text-xs"><Plus className="h-3.5 w-3.5 mr-1.5" />Add New Case</Button>
              </DialogTrigger>
              <DialogContent
                className="sm:max-w-3xl"
                style={{ maxHeight: "85vh", overflowY: "auto" }}
                onPointerDownOutside={(e) => {
                  if (isSubmitting || isUploading || isLibraryUploading) e.preventDefault();
                }}
                onEscapeKeyDown={(e) => {
                  if (isSubmitting || isUploading || isLibraryUploading) e.preventDefault();
                }}
              >
                <DialogHeader>
                  <DialogTitle>Submit New Case</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="single" className="mt-2">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="single">Single Case</TabsTrigger>
                    <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
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
                              <FileArchive className="h-5 w-5" />
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

                    {category === "Implant" ? (
                      <>
                        <div className="space-y-2">
                          <Label>Category</Label>
                          <Select value={category} onValueChange={(v) => { setCategory(v); setSubTypeData(v === "Implant" ? { caseType2: "None" } : {}); }}>
                            <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-emerald-800 text-white">
                              {Object.keys(CASE_HIERARCHY).map((cat) => (
                                <SelectItem key={cat} value={cat} className="focus:bg-emerald-700 focus:text-white">
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
                            onValueChange={(v) => setSubTypeData({ ...subTypeData, caseType1: v })}
                          >
                            <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue placeholder="Select Sub Type 1" /></SelectTrigger>
                            <SelectContent className="bg-emerald-800 text-white">
                              {CASE_HIERARCHY["Implant"].fields[0].options.map((opt) => (
                                <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white">
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Tooth Selection ({toothSystem === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})</Label>
                          <ToothChart selected={teeth} onChange={setTeeth} system={toothSystem} onChangeSystem={setToothSystem} />
                        </div>

                        <div className="space-y-2">
                          <Label>Model Required?</Label>
                          <RadioGroup value={modelRequired} onValueChange={setModelRequired} className="flex gap-6 pt-2">
                            <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="m-yes" /><Label htmlFor="m-yes" className="font-normal">Yes</Label></div>
                            <div className="flex items-center gap-2"><RadioGroupItem value="no" id="m-no" /><Label htmlFor="m-no" className="font-normal">No</Label></div>
                          </RadioGroup>
                        </div>

                        <div className="space-y-2">
                          <Label>Preferred Teeth Library</Label>
                          <Select value={preferredTeethLibrary} onValueChange={setPreferredTeethLibrary}>
                            <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
                              <SelectValue placeholder="Select Preferred Teeth Library" />
                            </SelectTrigger>
                            <SelectContent className="bg-emerald-800 text-white">
                              <SelectItem value="default" className="focus:bg-emerald-700 focus:text-white">Default Teeth Library</SelectItem>
                              <SelectItem value="other" className="focus:bg-emerald-700 focus:text-white">Other Teeth Library</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {preferredTeethLibrary === "other" && (
                          <div className="space-y-2">
                            <Label>Teeth Library File (.dme or .zip, max 2GB)</Label>
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
                                  <p className="text-sm font-medium text-foreground">Uploading Teeth Library... {libraryUploadProgress}%</p>
                                  <div className="w-full bg-muted rounded-full h-1.5 max-w-xs mx-auto">
                                    <div className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${libraryUploadProgress}%` }}></div>
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
                                        ({(uploadedLibraryFile.fileSize / 1024 / 1024).toFixed(2)} MB)
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
                                      await handleDeleteUploadedFile(uploadedLibraryFile.fileName);
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
                                  <p className="text-sm font-medium text-foreground">Click to upload Custom Teeth Library</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">ZIP or DME (Max 2GB)</p>
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
                            <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue placeholder="Select Crown & Bridge type" /></SelectTrigger>
                            <SelectContent className="bg-emerald-800 text-white">
                              {CASE_HIERARCHY["Implant"].fields[1].options.map((opt) => (
                                <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white">
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {subTypeData.caseType2 && subTypeData.caseType2 !== "None" && (
                          <div className="space-y-2">
                            <Label>Teeth for Crown & Bridge Selection ({toothSystem === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})</Label>
                            <ToothChart selected={crownBridgeTeeth} onChange={setCrownBridgeTeeth} system={toothSystem} onChangeSystem={setToothSystem} />
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Category</Label>
                            <Select value={category} onValueChange={(v) => { setCategory(v); setSubTypeData(v === "Implant" ? { caseType2: "None" } : {}); }}>
                              <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue /></SelectTrigger>
                              <SelectContent className="bg-emerald-800 text-white">
                                {Object.keys(CASE_HIERARCHY).map((cat) => (
                                  <SelectItem key={cat} value={cat} className="focus:bg-emerald-700 focus:text-white">
                                    {cat}
                                  </SelectItem>
                                ))}
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

                        {/* Dynamic Fields */}
                        {CASE_HIERARCHY[category as keyof typeof CASE_HIERARCHY]?.fields.map((field) => (
                          <div className="space-y-2" key={field.name}>
                            <Label>{field.label}</Label>
                            <Select
                              value={subTypeData[field.name] || ""}
                              onValueChange={(v) => setSubTypeData({ ...subTypeData, [field.name]: v })}
                            >
                              <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
                              <SelectContent className="bg-emerald-800 text-white">
                                {field.options.map((opt) => (
                                  <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white">
                                    {opt}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}

                        <div className="space-y-2">
                          <Label>Tooth Selection ({toothSystem === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})</Label>
                          <ToothChart selected={teeth} onChange={setTeeth} system={toothSystem} onChangeSystem={setToothSystem} />
                        </div>

                        <div className="space-y-2">
                          <Label>Preferred Teeth Library</Label>
                          <Select value={preferredTeethLibrary} onValueChange={setPreferredTeethLibrary}>
                            <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900">
                              <SelectValue placeholder="Select Preferred Teeth Library" />
                            </SelectTrigger>
                            <SelectContent className="bg-emerald-800 text-white">
                              <SelectItem value="default" className="focus:bg-emerald-700 focus:text-white">Default Teeth Library</SelectItem>
                              <SelectItem value="other" className="focus:bg-emerald-700 focus:text-white">Other Teeth Library</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {preferredTeethLibrary === "other" && (
                          <div className="space-y-2">
                            <Label>Teeth Library File (.dme or .zip, max 2GB)</Label>
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
                                  <p className="text-sm font-medium text-foreground">Uploading Teeth Library... {libraryUploadProgress}%</p>
                                  <div className="w-full bg-muted rounded-full h-1.5 max-w-xs mx-auto">
                                    <div className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${libraryUploadProgress}%` }}></div>
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
                                        ({(uploadedLibraryFile.fileSize / 1024 / 1024).toFixed(2)} MB)
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
                                      await handleDeleteUploadedFile(uploadedLibraryFile.fileName);
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
                                  <p className="text-sm font-medium text-foreground">Click to upload Custom Teeth Library</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">ZIP or DME (Max 2GB)</p>
                                </div>
                              </label>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    <div className="space-y-2">
                      <Label>Additional Notes</Label>
                      <Textarea placeholder="Special instructions, shade reference, occlusion notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                    <Button
                      className="w-full bg-emerald-800 text-white hover:bg-emerald-900 font-semibold h-9 rounded-md text-xs mt-2 flex items-center justify-center gap-1.5"
                      onClick={handleSubmit}
                      disabled={isSubmitting || isUploading || isLibraryUploading || submitCooldown}
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
                      <label className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors block">
                        <input
                          ref={bulkFileRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => onBulkFiles(e.target.files)}
                        />
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
                                    <FileArchive className="h-4 w-4 text-emerald-600 shrink-0" />
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
                                    <div className="w-full bg-muted rounded-full h-1">
                                      <div className="bg-emerald-600 h-1 rounded-full transition-all duration-300" style={{ width: `${row.uploadProgress}%` }}></div>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground text-right">Uploading... {row.uploadProgress}%</p>
                                  </div>
                                )}
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Category</Label>
                                    <Select value={row.category} onValueChange={(v) => updateBulkRow(i, { category: v, subTypeData: v === "Implant" ? { caseType2: "None" } : {} })}>
                                      <SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue /></SelectTrigger>
                                      <SelectContent className="bg-emerald-800 text-white">
                                        {Object.keys(CASE_HIERARCHY).map((cat) => (
                                          <SelectItem key={cat} value={cat} className="focus:bg-emerald-700 focus:text-white">
                                            {cat}
                                          </SelectItem>
                                        ))}
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

                                {/* Dynamic Fields */}
                                {row.category === "Implant" ? (
                                  <>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Sub Type 1</Label>
                                      <Select
                                        value={row.subTypeData["caseType1"] || ""}
                                        onValueChange={(v) => updateBulkRow(i, { subTypeData: { ...row.subTypeData, caseType1: v } })}
                                      >
                                        <SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue placeholder="Select Sub Type 1" /></SelectTrigger>
                                        <SelectContent className="bg-emerald-800 text-white">
                                          {CASE_HIERARCHY["Implant"].fields[0].options.map((opt) => (
                                            <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white">
                                              {opt}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    <div className="space-y-1">
                                      <Label className="text-xs">Teeth for Implant ({row.toothSystem === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})</Label>
                                      <ToothChart selected={row.teeth} onChange={(t) => updateBulkRow(i, { teeth: t })} system={row.toothSystem} onChangeSystem={(sys) => updateBulkRow(i, { toothSystem: sys })} />
                                    </div>

                                    <div className="space-y-1">
                                      <Label className="text-xs">Crown & Bridge type (optional)</Label>
                                      <Select
                                        value={row.subTypeData["caseType2"] || "None"}
                                        onValueChange={(v) => {
                                          const nextSubTypeData: Record<string, any> = { ...row.subTypeData, caseType2: v };
                                          if (v === "None") {
                                            delete nextSubTypeData.crownBridgeTeeth;
                                          }
                                          updateBulkRow(i, { subTypeData: nextSubTypeData });
                                        }}
                                      >
                                        <SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue placeholder="Select Crown & Bridge type" /></SelectTrigger>
                                        <SelectContent className="bg-emerald-800 text-white">
                                          {CASE_HIERARCHY["Implant"].fields[1].options.map((opt) => (
                                            <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white">
                                              {opt}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    {row.subTypeData.caseType2 && row.subTypeData.caseType2 !== "None" && (
                                      <div className="space-y-1">
                                        <Label className="text-xs">Teeth for Crown & Bridge ({row.toothSystem === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})</Label>
                                        <ToothChart
                                          selected={row.subTypeData.crownBridgeTeeth || []}
                                          onChange={(t) => updateBulkRow(i, { subTypeData: { ...row.subTypeData, crownBridgeTeeth: t } })}
                                          system={row.toothSystem}
                                          onChangeSystem={(sys) => updateBulkRow(i, { toothSystem: sys })}
                                        />
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {CASE_HIERARCHY[row.category as keyof typeof CASE_HIERARCHY]?.fields.map((field) => (
                                      <div className="space-y-1" key={field.name}>
                                        <Label className="text-xs">{field.label}</Label>
                                        <Select
                                          value={row.subTypeData[field.name] || ""}
                                          onValueChange={(v) => updateBulkRow(i, { subTypeData: { ...row.subTypeData, [field.name]: v } })}
                                        >
                                          <SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900"><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
                                          <SelectContent className="bg-emerald-800 text-white">
                                            {field.options.map((opt) => (
                                              <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white">
                                                {opt}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    ))}
                                    <ToothChart selected={row.teeth} onChange={(t) => updateBulkRow(i, { teeth: t })} system={row.toothSystem} onChangeSystem={(sys) => updateBulkRow(i, { toothSystem: sys })} />
                                  </>
                                )}
                                <Textarea
                                  value={row.notes}
                                  onChange={(e) => updateBulkRow(i, { notes: e.target.value })}
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
                          disabled={isSubmitting || submitCooldown || bulkRows.some(row => row.isUploading)}
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
                <Input className="pl-9 h-8 text-xs" placeholder="Search cases..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setSearch("")
                  setTypeFilter("All")
                  setStatusFilter("All")
                  setFrom("")
                  setTo("")
                }}
              >
                Clear
              </Button>
            </div>
            <div className="flex gap-1 flex-wrap">
              {statusFilters.map((s) => (
                <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" className="h-7 text-[10px] px-2" onClick={() => setStatusFilter(s)}>
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
                    {["Case ID", "Type", "Case Sub Type", "Teeth", "Status", "Designer", "CreatedAt"].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-3.5 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <tr key={idx} className="animate-pulse">
                        <td className="px-3.5 py-2.5"><div className="h-3.5 bg-muted rounded w-20"></div></td>
                        <td className="px-3.5 py-2.5"><div className="h-3.5 bg-muted rounded w-24"></div></td>
                        <td className="px-3.5 py-2.5"><div className="h-3.5 bg-muted rounded w-28"></div></td>
                        <td className="px-3.5 py-2.5"><div className="h-3.5 bg-muted rounded w-12"></div></td>
                        <td className="px-3.5 py-2.5"><div className="h-5.5 bg-muted rounded-full w-20"></div></td>
                        <td className="px-3.5 py-2.5"><div className="h-3.5 bg-muted rounded w-20"></div></td>
                        <td className="px-3.5 py-2.5"><div className="h-3.5 bg-muted rounded w-16"></div></td>
                      </tr>
                    ))
                  ) : (
                    filtered.map((c) => {
                      const toothNumbers = c.subTypeData?.teeth || [];
                      const toothSystem = c.subTypeData?.toothSystem || "USA";
                      const restoration = c.subTypeData
                        ? Object.entries(c.subTypeData)
                          .filter(([k, v]) => k !== 'teeth' && k !== 'crownBridgeTeeth' && k !== 'toothSystem' && k !== 'notes' && k !== 'modelRequired' && typeof v === 'string' && v && v.toLowerCase() !== 'none')
                          .map(([, v]) => v)
                          .join(" - ")
                        : c.category || "—";

                      const createdAtFormatted = c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : "—";

                      return (
                        <tr
                          key={c.id}
                          className={`cursor-pointer transition-colors border-l-2 ${c.status === "on_hold" ? "bg-red-50 hover:bg-red-100/80 border-l-red-500" : c.status === "submitted_to_client" ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.08] border-l-amber-500 font-medium" : "hover:bg-muted/10 border-l-transparent"}`}
                          onClick={() => router.push(`/client/cases/${c.id}`)}
                        >
                          <td className="px-3.5 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-[11px] text-slate-800">{c.caseNumber || c.id}</span>
                              {(() => {
                                const hasUnreadChat = Boolean(c.hasUnreadChat);
                                const todayCount = (c as any).todayMessagesCount || 0;
                                if (!hasUnreadChat && todayCount === 0) return null;
                                return (
                                  <span className="relative inline-flex items-center shrink-0" title={hasUnreadChat ? "New Messages" : `${todayCount} messages today`}>
                                    <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${hasUnreadChat ? "text-emerald-500" : "text-slate-400"}`} />
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
                          <td className="px-3.5 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{c.category}</td>
                          <td className="px-3.5 py-2 text-[11px] text-foreground font-semibold">{restoration || "—"}</td>
                          <td className="px-3.5 py-2 text-[10px] text-muted-foreground">
                            {c.category === "Implant" ? (
                              <div className="flex flex-col">
                                <span>Imp: {toothNumbers.length ? `#${toothNumbers.join(", #")}` : "—"}</span>
                                {(() => {
                                  const cbToothNumbers = c.subTypeData?.crownBridgeTeeth || [];
                                  return cbToothNumbers.length > 0 && (
                                    <span>C&B: #{cbToothNumbers.join(", #")}</span>
                                  );
                                })()}
                              </div>
                            ) : (
                              toothNumbers.length ? `#${toothNumbers.join(", #")} (${toothSystem === "USA" ? "Universal" : toothSystem})` : "—"
                            )}
                          </td>
                          <td className="px-3.5 py-2">
                            <div className="scale-90 origin-left">
                              <StatusBadge status={c.status} />
                            </div>
                          </td>
                          <td className="px-3.5 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{c.designerName || "—"}</td>
                          <td className="px-3.5 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{createdAtFormatted}</td>
                        </tr>
                      );
                    })
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-3.5 py-8 text-center text-xs text-muted-foreground">No cases match your filters</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ClientLayout>
  );
}
