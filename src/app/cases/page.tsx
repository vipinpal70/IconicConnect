"use client"

import { useMemo, useState, useRef, useEffect } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { generateCaseId } from "@/src/lib/case-utils";
import { OpsLayout } from "@/src/components/OpsLayout";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { StatusBadge } from "@/src/components/StatusBadge";
import { ToothChart } from "@/src/components/ToothChart";
import { type CaseStatus } from "@/src/data/demoData";
import { Plus, Search, Download, Upload, X, FileBox, UserPlus, ClipboardCheck, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Label } from "@/src/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

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
        const percentage = Math.round((event.loaded / event.total) * 100);
        onProgress(percentage);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          onSuccess(res);
        } catch (e) {
          onError('Failed to parse response');
        }
      } else {
        onError('Upload failed with status ' + xhr.status);
      }
    };

    xhr.onerror = () => onError('Upload failed');

    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  } catch (err: any) {
    onError(err.message || 'Initialization failed');
  }
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
    '.txt'
  ];

  if (!allowedExtensions.includes(ext)) {
    return { isValid: false, error: `File type "${ext}" is not supported. Allowed formats: PNG, JPG, JPEG, MP4/video, PDF, ZIP, DOC, DOCX, TXT` };
  }

  return { isValid: true };
};

const statusFilters: (CaseStatus | "All")[] = [
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
  const fields = CASE_HIERARCHY[category as keyof typeof CASE_HIERARCHY]?.fields || []
  const allDynamicFieldsSelected = fields.every((field) => Boolean(subTypeData[field.name]))

  return Boolean(
    category &&
    uploadedFile &&
    allDynamicFieldsSelected &&
    notes.trim() &&
    teeth.length > 0
  )
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
      { name: "caseType2", label: "Case Type 2", type: "select", options: ["Lower", "Upper", "Full Arches"] }
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
      { name: "caseType1", label: "Case Type 1", type: "select", options: ["Robotic", "Custom", "Ti-Base"] },
      { name: "caseType2", label: "Case Type 2", type: "select", options: ["crown", "bridge", "coping", "screw retained", "in-lay", "on-lay"] }
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

  const fetchCases = async () => {
    setIsLoading(true);
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
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [assignQcCaseId, setAssignQcCaseId] = useState<string | null>(null);
  const [selectedQcId, setSelectedQcId] = useState<string>("");

  // Fetch active operations members (designers, QCs)
  const { data: membersData } = useQuery<any[]>({
    queryKey: ["ops-members-list"],
    queryFn: async () => {
      const res = await fetch("/api/admin/members")
      if (!res.ok) return []
      return res.json()
    }
  })

  // Fetch current logged in user
  const { data: currentUser } = useQuery<{ id: string; role: string; fullName: string | null }>({
    queryKey: ["ops-me"],
    queryFn: async () => {
      const res = await fetch("/api/admin/me")
      if (!res.ok) return null
      return res.json()
    }
  })

  // Live database updates
  const handleUpdate = async (caseId: string, patch: Record<string, string | number | boolean | null>, successMessage: string) => {
    setUpdatingId(caseId)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      })

      if (res.ok) {
        toast.success(successMessage)
        fetchCases()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to update case")
      }
    } catch {
      toast.error("Failed to update case")
    } finally {
      setUpdatingId(null)
    }
  }

  // Extract active designers for the allocate dropdown
  const designers = useMemo(() => {
    if (!membersData) return []
    return membersData.filter((m) => m.role === "designer" && m.status === "active")
  }, [membersData])

  // Extract active QCs for the allocate dropdown
  const qcs = useMemo(() => {
    if (!membersData) return []
    return membersData.filter((m) => m.role === "qc" && m.status === "active")
  }, [membersData])

  // Add Case form
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
  const [uploadedFile, setUploadedFile] = useState<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
  } | null>(null);
  const [generatedCaseId, setGeneratedCaseId] = useState<string>("");
  const [labName, setLabName] = useState<string>("Client");
  const [userProfile, setUserProfile] = useState<{ id: string; role: string; fullName: string | null } | null>(null);

  useEffect(() => {
    setGeneratedCaseId(generateCaseId(category));
  }, [category]);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch("/api/admin/me");
        if (res.ok) {
          const profile = await res.json();
          if (profile) {
            setUserProfile({
              id: profile.id,
              role: profile.role,
              fullName: profile.fullName || null,
            });
            if (profile.labName) setLabName(profile.labName);
          }
        }
      } catch (err) {
        console.error("Error fetching operations profile:", err);
      }
    }
    fetchProfile();
  }, []);

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

  // Bulk upload
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    return cases.filter((c) => {
      const s = search.toLowerCase();
      const friendlyId = (c.caseNumber || c.id || "").toLowerCase();
      const friendlyRestoration = (
        c.subTypeData
          ? Object.entries(c.subTypeData)
            .filter(([k, v]) => k !== 'teeth' && k !== 'notes' && k !== 'modelRequired' && typeof v === 'string' && v)
            .map(([_, v]) => v)
            .join(" - ")
          : c.category || ""
      ).toLowerCase();

      const matchesSearch =
        !s ||
        friendlyId.includes(s) ||
        friendlyRestoration.includes(s);

      // Map UI filters to database enums
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

      const matchesStatus =
        statusFilter === "All" ||
        (statusFilterMap[statusFilter] && statusFilterMap[statusFilter].includes(c.status));

      const matchesType = typeFilter === "All" || c.category === typeFilter;

      const createdAtDate = c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : "";
      const matchesFrom = !from || createdAtDate >= from;
      const matchesTo = !to || createdAtDate <= to;

      return matchesSearch && matchesStatus && matchesType && matchesFrom && matchesTo;
    });
  }, [cases, search, statusFilter, typeFilter, from, to]);

  const handleSubmit = async () => {
    if (!hasAllRequiredCaseFields(category, subTypeData, notes, teeth, uploadedFile)) {
      toast.error("Please complete all fields, select teeth, add notes, and upload a file.")
      return
    }

    const formData = new FormData();
    const caseData = {
      category,
      subTypeData: {
        ...subTypeData,
        modelRequired,
        teeth,
        toothSystem,
        notes,
      },
      caseNumber: generatedCaseId,
      uploadedFile,
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
        setToothSystem("USA");
        setModelRequired("no");
        setCategory("Crown & Bridges");
        setSubTypeData({});
        setSingleFile(null);
        setUploadedFileUrl(null);
        setUploadedFile(null);
        setGeneratedCaseId(generateCaseId("Crown & Bridges"));
        fetchCases();
      } else {
        toast.error("Failed to submit case.");
        console.error('Failed to submit single case');
      }
    } catch (error) {
      toast.error("An error occurred during submission.");
      console.error('Single submit error:', error);
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
      const caseId = generateCaseId("Crown & Bridges");
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
    if (bulkRows.length === 0) return;

    const hasInvalidRow = bulkRows.some((row) => !hasAllRequiredCaseFields(row.category, row.subTypeData, row.notes, row.teeth, row.uploadedFile))
    if (hasInvalidRow) {
      toast.error("Complete all fields, teeth selection, notes, and file upload for every case.")
      return
    }

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
      caseNumber: row.caseId,
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
    }
  };

  return (
    <OpsLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Cases</h1>
            <p className="text-sm text-muted-foreground mt-1">{cases.length} lifetime cases · {filtered.length} shown</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" /> Export Excel
            </Button>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Add New Case</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
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
                      <label className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors block ${isUploading ? 'border-emerald-500 bg-emerald-50/10' : 'border-border hover:border-emerald-800'}`}>
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileSelect(file);
                          }}
                        />
                        {isUploading ? (
                          <div className="space-y-2">
                            <Upload className="h-6 w-6 mx-auto text-emerald-600 animate-pulse" />
                            <p className="text-sm font-medium text-foreground">Uploading... {uploadProgress}%</p>
                            <div className="w-full bg-muted rounded-full h-1.5 max-width-xs mx-auto">
                              <div className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                            </div>
                          </div>
                        ) : uploadedFileUrl ? (
                          <div className="space-y-1 text-center">
                            <FileBox className="h-8 w-8 mx-auto text-emerald-600 animate-bounce" />
                            <p className="text-sm font-semibold text-foreground truncate max-w-md mx-auto">{singleFile?.name}</p>
                            <p className="text-xs text-muted-foreground">({singleFile ? (singleFile.size / 1024 / 1024).toFixed(2) : 0} MB)</p>
                            <p className="text-sm text-emerald-600 flex items-center justify-center gap-1 font-medium mt-1">
                              <span className="inline-block bg-emerald-600 text-white rounded-full px-1 text-[10px] font-bold">✓</span> File uploaded at light speed!
                            </p>
                          </div>
                        ) : (
                          <div>
                            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                            <p className="text-sm font-medium text-foreground">Drop file here or click to upload</p>
                            <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, MP4, PDF, ZIP, DOC, DOCX, TXT (Max 2GB)</p>
                          </div>
                        )}
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Select value={category} onValueChange={(v) => { setCategory(v); setSubTypeData({}); }}>
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
                      <Label>Additional Notes</Label>
                      <Textarea placeholder="Special instructions, shade reference, occlusion notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>

                    <Button className="w-full bg-emerald-800 text-white hover:bg-emerald-900" onClick={handleSubmit}>Submit Case</Button>
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
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">{bulkRows.length} cases ready</p>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => bulkFileRef.current?.click()}>Replace Selection</Button>
                            <Button variant="ghost" size="sm" onClick={() => setBulkRows([])}>Clear</Button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {bulkRows.map((row, i) => (
                            <Card key={i} className="shadow-sm">
                              <CardContent className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <FileBox className="h-4 w-4 text-emerald-600 shrink-0" />
                                    <p className="text-sm font-medium text-foreground truncate">{row.fileName}</p>
                                    {row.uploadedUrl && <span className="text-emerald-600 text-xs flex items-center font-semibold ml-1">✓ Uploaded</span>}
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeBulkRow(i)}><X className="h-4 w-4" /></Button>
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
                                    <Select value={row.category} onValueChange={(v) => updateBulkRow(i, { category: v, subTypeData: {} })}>
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
                                <ToothChart
                                  selected={row.teeth}
                                  onChange={(t) => updateBulkRow(i, { teeth: t })}
                                  system={row.toothSystem}
                                  onChangeSystem={(sys) => updateBulkRow(i, { toothSystem: sys })}
                                />
                                <Textarea
                                  value={row.notes}
                                  onChange={(e) => updateBulkRow(i, { notes: e.target.value })}
                                  placeholder="Notes for this case…"
                                  className="min-h-[60px]"
                                />
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
        <Card className="shadow-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search cases..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v)}>
                <SelectTrigger className="w-full lg:w-56"><SelectValue placeholder="Case type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Case Types</SelectItem>
                  {Object.keys(CASE_HIERARCHY).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full lg:w-44" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full lg:w-44" />
              <Button
                variant="outline"
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
            <div className="flex gap-1.5 flex-wrap">
              {statusFilters.map((s) => (
                <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="shadow-card">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/30">
                  <tr className="border-b border-border">
                    {["Case ID", "Type", "Case Sub Type", "Teeth", "Status", "Designer", "CreatedAt", "Actions"].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <tr key={idx} className="animate-pulse">
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-20"></div></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-28"></div></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-32"></div></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-16"></div></td>
                        <td className="px-6 py-4"><div className="h-6 bg-muted rounded-full w-24"></div></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24"></div></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-20"></div></td>
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24"></div></td>
                      </tr>
                    ))
                  ) : (
                    filtered.map((c) => {
                       const toothNumbers = c.subTypeData?.teeth || [];
                       const toothSystem = c.subTypeData?.toothSystem || "USA";
                       const restoration = c.subTypeData
                        ? Object.entries(c.subTypeData)
                          .filter(([k, v]) => k !== 'teeth' && k !== 'toothSystem' && k !== 'notes' && k !== 'modelRequired' && typeof v === 'string' && v)
                          .map(([, v]) => v)
                          .join(" - ")
                        : c.category || "—";

                       const createdAtFormatted = c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : "—";

                       const isMutating = updatingId === c.id;

                       return (
                        <tr
                          key={c.id}
                          className="hover:bg-muted/10 cursor-pointer transition-colors"
                          onClick={() => router.push(`/cases/${c.id}`)}
                        >
                          <td className="px-6 py-4 text-sm font-medium text-primary">{c.caseNumber || c.id}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">{c.category}</td>
                          <td className="px-6 py-4 text-sm text-foreground">{restoration || "—"}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">{toothNumbers.length ? `#${toothNumbers.join(", #")} (${toothSystem})` : "—"}</td>
                           <td className="px-6 py-4"><StatusBadge status={c.status} role="internal" /></td>
                          <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">{c.designerName || "—"}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">{createdAtFormatted}</td>
                           <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                             <div className="flex gap-2 items-center flex-wrap">
                               {/* 1. Admin and QC Lead actions */}
                               {((userProfile?.role || currentUser?.role) === "admin" || (userProfile?.role || currentUser?.role) === "qc") && (
                                 <>
                                   {c.status === "scan_received" && (
                                     <>
                                       <Button
                                         size="sm"
                                         variant="outline"
                                         disabled={isMutating}
                                         onClick={() => handleUpdate(c.id, { status: "scan_verified" }, `Scan validated · ready for allocation`)}
                                         title="Validate scan"
                                         className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-none font-medium shadow-sm"
                                       >
                                         <ShieldCheck className="h-3.5 w-3.5 mr-1" />Validate
                                       </Button>
                                       <AllocateMenu
                                         designers={designers}
                                         disabled={isMutating}
                                         onPick={(dId) => handleUpdate(c.id, { designerId: dId, status: "allocated_to_designer" }, `Allocated case to designer`)}
                                       />
                                     </>
                                   )}

                                   {(c.status === "scan_verified" || c.status === "scan_not_verified") && (
                                     <AllocateMenu
                                       designers={designers}
                                       disabled={isMutating}
                                       onPick={(dId) => handleUpdate(c.id, { designerId: dId, status: "allocated_to_designer" }, `Allocated case to designer`)}
                                     />
                                   )}

                                   {(c.status === "allocated_to_designer" || c.status === "in_progress") && (
                                     <>
                                       {!c.designerId ? (
                                         <AllocateMenu
                                           designers={designers}
                                           disabled={isMutating}
                                           onPick={(dId) => handleUpdate(c.id, { designerId: dId, status: "allocated_to_designer" }, `Allocated case to designer`)}
                                         />
                                       ) : (
                                         <>
                                           {!c.qcId ? (
                                             <Button
                                               size="sm"
                                               variant="outline"
                                               disabled={isMutating}
                                               onClick={() => setAssignQcCaseId(c.id)}
                                               className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm font-medium"
                                             >
                                               <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign QC
                                             </Button>
                                           ) : (
                                             <Button
                                               size="sm"
                                               variant="outline"
                                               disabled={isMutating}
                                               onClick={() => handleUpdate(c.id, { status: "internal_qc" }, `Submitted case to Internal QC`)}
                                               className="h-8 text-xs bg-primary border-primary/50 text-white font-medium hover:bg-zinc-800"
                                             >
                                               <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Send to QC
                                             </Button>
                                           )}
                                         </>
                                       )}
                                     </>
                                   )}

                                   {c.status === "internal_qc" && (
                                     <div className="flex flex-wrap gap-1.5 items-center">
                                       <Button
                                         size="sm"
                                         disabled={isMutating}
                                         onClick={() => handleUpdate(c.id, { status: "submitted_to_client" }, `Approved QC and sent design to client`)}
                                         className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-all"
                                       >
                                         ✓ Approve
                                       </Button>
                                       <Button
                                         size="sm"
                                         variant="destructive"
                                         disabled={isMutating}
                                         onClick={() => handleUpdate(c.id, { status: "in_progress" }, `Rejected design; sent back to designer`)}
                                         className="h-8 text-xs font-medium bg-red-600 hover:bg-red-700 shadow-sm transition-all"
                                       >
                                         ✗ Reject
                                       </Button>
                                       <Button
                                         size="sm"
                                         disabled={isMutating}
                                         onClick={() => handleUpdate(c.id, { status: "in_progress" }, `Feedback logged; sent back to designer`)}
                                         className="h-8 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all"
                                       >
                                         💬 Feedback
                                       </Button>
                                       <Button
                                         size="sm"
                                         disabled={isMutating}
                                         onClick={() => handleUpdate(c.id, { status: "on_hold" }, `Case put on hold by QC Lead`)}
                                         className="h-8 text-xs font-medium bg-gray-500 hover:bg-gray-600 text-white shadow-sm transition-all"
                                       >
                                         ⏸ Hold
                                       </Button>
                                     </div>
                                   )}

                                   {c.status === "client_feedback" && (
                                     <Button
                                       size="sm"
                                       variant="outline"
                                       disabled={isMutating}
                                       onClick={() => handleUpdate(c.id, { status: "in_progress" }, `Sent case back to design`)}
                                       className="h-8 text-xs"
                                     >
                                       Back to designer
                                     </Button>
                                   )}
                                 </>
                               )}

                               {/* 2. Designer actions */}
                               {(userProfile?.role || currentUser?.role) === "designer" && (
                                 <>
                                   {/* Allocate to Self for unallocated cases */}
                                   {!c.designerId && (c.status === "scan_received" || c.status === "scan_verified") && (
                                     <Button
                                       size="sm"
                                       disabled={isMutating}
                                       onClick={() => handleUpdate(c.id, { designerId: (userProfile?.id || currentUser?.id || null), status: "allocated_to_designer" }, `Allocated case to yourself`)}
                                       className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-all"
                                     >
                                       <UserPlus className="h-3.5 w-3.5 mr-1" /> Allocate to Self
                                     </Button>
                                   )}

                                   {/* Actions on assigned cases */}
                                   {c.designerId === (userProfile?.id || currentUser?.id) && (
                                     <>
                                       {c.status === "allocated_to_designer" && (
                                         <div className="flex gap-2">
                                           <Button
                                             size="sm"
                                             disabled={isMutating}
                                             onClick={() => handleUpdate(c.id, { status: "in_progress" }, `Started design work`)}
                                             className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-sm"
                                           >
                                             Start Work
                                           </Button>
                                           {!c.qcId && (
                                             <Button
                                               size="sm"
                                               variant="outline"
                                               disabled={isMutating}
                                               onClick={() => setAssignQcCaseId(c.id)}
                                               className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm font-medium"
                                             >
                                               <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign QC
                                             </Button>
                                           )}
                                         </div>
                                       )}

                                       {c.status === "in_progress" && (
                                         <>
                                           {!c.qcId ? (
                                             <Button
                                               size="sm"
                                               variant="outline"
                                               disabled={isMutating}
                                               onClick={() => setAssignQcCaseId(c.id)}
                                               className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm font-medium"
                                             >
                                               <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign QC
                                             </Button>
                                           ) : (
                                             <Button
                                               size="sm"
                                               variant="outline"
                                               disabled={isMutating}
                                               onClick={() => handleUpdate(c.id, { status: "internal_qc" }, `Submitted case to Internal QC`)}
                                               className="h-8 text-xs bg-primary border-primary/50 text-white font-medium hover:bg-zinc-800"
                                             >
                                               <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Send to QC
                                             </Button>
                                           )}
                                         </>
                                       )}
                                     </>
                                   )}
                                 </>
                               )}
                               {(userProfile || currentUser) && !["admin", "qc", "designer"].includes((userProfile?.role || currentUser?.role) || "") && (
                                 <span className="text-xs text-muted-foreground italic">AM (Read-only)</span>
                               )}
                             </div>
                           </td>
                        </tr>
                      );
                    })
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-muted-foreground">No cases match your filters</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!assignQcCaseId} onOpenChange={(o) => { if (!o) { setAssignQcCaseId(null); setSelectedQcId(""); } }}>
        <DialogContent className="sm:max-w-[425px] bg-primary border-primary/50 text-white shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" /> Assign QC Lead
            </DialogTitle>
            <p className="text-xs text-zinc-300">
              Select an active Quality Control team member to allocate to this case and transition it to QC review.
            </p>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="qc-select" className="text-sm font-semibold text-zinc-200">
                QC Member
              </label>
              <Select value={selectedQcId} onValueChange={setSelectedQcId}>
                <SelectTrigger id="qc-select" className="bg-primary/80 border-primary-50/50 text-white focus:bg-emerald-600 focus:text-white">
                  <SelectValue placeholder="Select QC Lead" />
                </SelectTrigger>
                <SelectContent className="bg-primary border-primary-50/50 text-white">
                  {qcs.map((qc) => (
                    <SelectItem
                      key={qc.id}
                      value={qc.id}
                      className="text-white focus:bg-emerald-600 focus:text-white cursor-pointer"
                    >
                      {qc.fullName || qc.email}
                    </SelectItem>
                  ))}
                  {qcs.length === 0 && (
                    <p className="text-xs p-2 text-zinc-400">No active QC leads found.</p>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="ghost"
              onClick={() => { setAssignQcCaseId(null); setSelectedQcId(""); }}
              className="text-white hover:bg-zinc-800 animate-pulse"
            >
              Cancel
            </Button>
            <Button
              disabled={!selectedQcId || updatingId === assignQcCaseId}
              onClick={async () => {
                if (!assignQcCaseId || !selectedQcId) return
                await handleUpdate(
                  assignQcCaseId,
                  { qcId: selectedQcId, status: "internal_qc" },
                  "Successfully assigned QC lead and transitioned case status to Internal QC"
                )
                setAssignQcCaseId(null)
                setSelectedQcId("")
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              Assign & Transition
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </OpsLayout>
  );
}

function AllocateMenu({
  designers,
  onPick,
  disabled
}: {
  designers: any[]
  onPick: (designerId: string) => void
  disabled?: boolean
}) {
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
          <SelectItem value="none" disabled className="bg-primary text-white/50 focus:bg-[#047857] cursor-not-allowed">
            No active designers
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
