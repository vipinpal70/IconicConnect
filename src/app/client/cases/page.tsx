"use client"

import { useMemo, useState, useRef, useEffect } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { generateCaseId } from "@/src/lib/case-utils";
import { ClientLayout } from "@/src/components/ClientLayout";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { StatusBadge } from "@/src/components/StatusBadge";
import { ToothChart } from "@/src/components/ToothChart";
import { type CaseStatus } from "@/src/data/demoData";
import { Plus, Search, Download, Upload, X, FileBox } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Label } from "@/src/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
import { toast } from "sonner";

interface BulkRow {
  fileName: string;
  file: File;
  category: string;
  subTypeData: Record<string, string>;
  modelRequired: "yes" | "no";
  teeth: number[];
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

  const [category, setCategory] = useState<string>("Crown & Bridges");
  const [subTypeData, setSubTypeData] = useState<Record<string, string>>({});
  const [modelRequired, setModelRequired] = useState("no");
  const [teeth, setTeeth] = useState<number[]>([]);
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

  // Bulk upload
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGeneratedCaseId(generateCaseId(category));
  }, [category]);

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

  const filtered = useMemo(() => {
    return cases.filter((c) => {
      const s = search.toLowerCase();
      const friendlyId = (c.caseNumber || c.id || "").toLowerCase();
      const friendlyPatient = (c.patientName || "").toLowerCase();
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
        friendlyPatient.includes(s) ||
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
    if (!category) return;

    const formData = new FormData();
    const caseData = {
      patientName: "Single Patient",
      category,
      subTypeData: {
        ...subTypeData,
        modelRequired,
        teeth,
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
        setModelRequired("no");
        setCategory("Crown & Bridges");
        setSubTypeData({});
        setSingleFile(null);
        setUploadedFileUrl(null);
        setUploadedFile(null);
        // Regenerate for next time
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
    if (bulkRows.length === 0) return;

    const formData = new FormData();

    const casesData = bulkRows.map(row => ({
      patientName: `Bulk Patient (${row.fileName})`,
      category: row.category,
      subTypeData: {
        ...row.subTypeData,
        modelRequired: row.modelRequired,
        teeth: row.teeth,
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
    <ClientLayout>
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
                            <div className="w-full bg-muted rounded-full h-1.5 max-w-xs mx-auto">
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
                      <Label>Tooth Selection (USA Universal Numbering)</Label>
                      <ToothChart selected={teeth} onChange={setTeeth} />
                    </div>

                    <div className="space-y-2">
                      <Label>Additional Notes</Label>
                      <Textarea placeholder="Special instructions, shade reference, occlusion notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>

                    {/* <div className="space-y-2">
                      <Label>Case File</Label>
                      <Input type="file" onChange={(e) => setSingleFile(e.target.files?.[0] || null)} />
                    </div> */}

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
                                <ToothChart selected={row.teeth} onChange={(t) => updateBulkRow(i, { teeth: t })} />
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
                    {["Case ID", "Type", "Case Sub Type", "Teeth", "Status", "CreatedAt"].map((h) => (
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
                        <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-20"></div></td>
                      </tr>
                    ))
                  ) : (
                    filtered.map((c) => {
                      const toothNumbers = c.subTypeData?.teeth || [];
                      const restoration = c.subTypeData
                        ? Object.entries(c.subTypeData)
                            .filter(([k, v]) => k !== 'teeth' && k !== 'notes' && k !== 'modelRequired' && typeof v === 'string' && v)
                            .map(([_, v]) => v)
                            .join(" - ")
                        : c.category || "—";
                      
                      const createdAtFormatted = c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : "—";

                      return (
                        <tr
                          key={c.id}
                          className="hover:bg-muted/10 cursor-pointer transition-colors"
                          onClick={() => router.push(`/cases/${c.id}`)}
                        >
                          <td className="px-6 py-4 text-sm font-medium text-primary">{c.caseNumber || c.id}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">{c.category}</td>
                          <td className="px-6 py-4 text-sm text-foreground">{restoration || "—"}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">{toothNumbers.length ? `#${toothNumbers.join(", #")}` : "—"}</td>
                          <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                          <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">{createdAtFormatted}</td>
                        </tr>
                      );
                    })
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-muted-foreground">No cases match your filters</td></tr>
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
