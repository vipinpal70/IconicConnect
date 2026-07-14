"use client"

import React, { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Upload, FileArchive, RefreshCw, X, Plus, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/src/components/ui/select"
import { ToothChart } from "@/src/components/ToothChart"
import { generateCaseId } from "@/src/lib/case-utils"
import { uploadFileInChunks } from "@/src/lib/upload-utils"

interface ClientRecord {
  id: string
  fullName: string | null
  email: string
  labName: string | null
}

interface AddCaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: "client" | "admin"
  clients?: ClientRecord[]
  onSuccess?: () => void
}

interface Field {
  name: string
  label: string
  type: string
  options: string[]
  optional?: boolean
}

const ARCH_OPTIONS = ["Upper", "Lower", "Both Arches"] as const

const CASE_HIERARCHY: Record<string, { fields: Field[] }> = {
  "Crown & Bridge": {
    fields: [
      { name: "caseType", label: "Case Type", type: "select", options: ["Crown", "Bridge", "Cutback", "Coping", "Screw Retained", "In-Lay", "On-Lay"] }
    ]
  },
  "Denture": {
    fields: [
      { name: "caseType1", label: "Case Type", type: "select", options: ["Reference Denture", "Copy Denture", "Immediate Denture", "Full Denture", "Partial Denture"] },
      { name: "caseType2", label: "Arch", type: "select", options: [...ARCH_OPTIONS] }
    ]
  },
  "Cosmetic": {
    fields: [
      { name: "caseType", label: "Case Type", type: "select", options: ["Digital Wax Up", "Veneers", "Snap on Smile"] }
    ]
  },
  "Appliance": {
    fields: [
      { name: "caseType1", label: "Case Type", type: "select", options: ["Night Guard", "Sport Guard", "Mouth Guard", "NTI"] },
      { name: "occlusion", label: "Occlusion", type: "select", options: ["Even Occlusion", "Custom"] },
      { name: "arch", label: "Arch", type: "select", options: [...ARCH_OPTIONS] }
    ]
  },
  "Implant": {
    fields: [
      { name: "caseType1", label: "Sub Type", type: "select", options: ["Robotic", "Custom", "Ti-Base"] },
      { name: "caseType2", label: "Crown & Bridge type", type: "select", options: ["None", "Crown", "Bridge"], optional: true }
    ]
  }
}

export function AddCaseDialog({ open, onOpenChange, role, clients = [], onSuccess }: AddCaseDialogProps) {
  const router = useRouter()
  const [selectedClientId, setSelectedClientId] = useState<string>("")
  const [targetLabName, setTargetLabName] = useState<string>("Client")

  // Form State
  const [category, setCategory] = useState<string>("Crown & Bridge")
  const [subTypeData, setSubTypeData] = useState<Record<string, any>>({})
  const [modelRequired, setModelRequired] = useState("no")
  const [teeth, setTeeth] = useState<number[]>([])
  const [crownBridgeTeeth, setCrownBridgeTeeth] = useState<number[]>([])
  const [toothSystem, setToothSystem] = useState<"USA" | "FDI">("USA")
  const [notes, setNotes] = useState("")

  // File Upload State
  const [uploadedFilesList, setUploadedFilesList] = useState<Array<{
    fileUrl: string
    fileName: string
    fileSize: number
    fileType: string
  }>>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  // Teeth Library State
  const [preferredTeethLibrary, setPreferredTeethLibrary] = useState<string>("default")
  const [isLibraryUploading, setIsLibraryUploading] = useState(false)
  const [libraryUploadProgress, setLibraryUploadProgress] = useState(0)
  const [uploadedLibraryFile, setUploadedLibraryFile] = useState<{
    fileUrl: string
    fileName: string
    fileSize: number
    fileType: string
  } | null>(null)

  const [generatedCaseId, setGeneratedCaseId] = useState<string>("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitCooldown, setSubmitCooldown] = useState(false)
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const singleFileRef = useRef<HTMLInputElement>(null)
  const libraryFileRef = useRef<HTMLInputElement>(null)

  const [isDraggingCaseFile, setIsDraggingCaseFile] = useState(false)
  const [isDraggingLibraryFile, setIsDraggingLibraryFile] = useState(false)

  const handleCaseFileDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDraggingCaseFile(true)
    } else if (e.type === "dragleave" || e.type === "drop") {
      setIsDraggingCaseFile(false)
    }
  }

  const handleCaseFileDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingCaseFile(false)
    if (isSubmitting || isUploading) return

    const items = e.dataTransfer.items
    const filesOnly: File[] = []

    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (typeof items[i].webkitGetAsEntry === "function") {
          const item = items[i].webkitGetAsEntry()
          if (item) {
            if (item.isFile) {
              const file = items[i].getAsFile()
              if (file) filesOnly.push(file)
            }
          }
        } else {
          const file = items[i].getAsFile()
          if (file) filesOnly.push(file)
        }
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files)
      filesOnly.push(...files)
    }

    if (filesOnly.length > 0) {
      await handleMultipleFilesSelect(filesOnly)
    } else {
      toast.error("No valid files dropped. Folder uploads are not supported.")
    }
  }

  const handleLibraryFileDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDraggingLibraryFile(true)
    } else if (e.type === "dragleave" || e.type === "drop") {
      setIsDraggingLibraryFile(false)
    }
  }

  const handleLibraryFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingLibraryFile(false)
    if (isSubmitting) return

    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleLibraryFileSelect(file)
    }
  }

  useEffect(() => {
    setGeneratedCaseId(generateCaseId(category))
  }, [category])

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current)
      }
    }
  }, [])

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setSelectedClientId("")
      setTargetLabName("Client")
      setCategory("Crown & Bridge")
      setSubTypeData({})
      setModelRequired("no")
      setTeeth([])
      setCrownBridgeTeeth([])
      setToothSystem("USA")
      setNotes("")
      setUploadedFilesList([])
      setPreferredTeethLibrary("default")
      setUploadedLibraryFile(null)
      setGeneratedCaseId(generateCaseId("Crown & Bridge"))
      setIsSubmitting(false)
      setSubmitCooldown(false)
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
    }
  }, [open])

  const validateFile = (file: File): { isValid: boolean; error?: string } => {
    const maxLimit = 5 * 1024 * 1024 * 1024 // 5GB
    if (file.size > maxLimit) {
      return { isValid: false, error: `File size exceeds the 5GB limit. Size: ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB` }
    }
    const lastDot = file.name.lastIndexOf(".")
    const ext = lastDot !== -1 ? file.name.substring(lastDot).toLowerCase() : ""
    const blockedExtensions = [
      ".exe", ".msi", ".bat", ".cmd", ".sh", ".lnk", ".scr", ".vbs", ".js"
    ]
    if (blockedExtensions.includes(ext)) {
      return { isValid: false, error: "Executable/script files are not allowed for security reasons." }
    }
    return { isValid: true }
  }

  const uploadFileWithXHR = async (
    file: File,
    onProgress: (progress: number) => void,
    onSuccess: (res: { fileUrl: string; fileName: string; fileSize: number; fileType: string }) => void,
    onError: (err: string) => void
  ) => {
    await uploadFileInChunks(
      file,
      {
        clientId: role === "admin" ? selectedClientId : null,
        role: role
      },
      onProgress,
      onSuccess,
      onError
    )
  }

  const handleMultipleFilesSelect = async (files: File[]) => {
    if (role === "admin" && !selectedClientId) {
      toast.error("Please select a client before uploading files.")
      return
    }

    const validFiles: File[] = []
    for (const file of files) {
      const check = validateFile(file)
      if (check.isValid) {
        validFiles.push(file)
      } else {
        toast.warning(`Skipped "${file.name}": ${check.error}`)
      }
    }

    if (validFiles.length === 0) {
      toast.error("No valid files selected for upload.")
      return
    }

    setIsUploading(true)
    setUploadProgress(0)

    const uploadedResults: Array<{
      fileUrl: string
      fileName: string
      fileSize: number
      fileType: string
    }> = []

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i]
        const onFileProgress = (pct: number) => {
          const baseProgress = (i / validFiles.length) * 100
          const fileContribution = (pct / 100) * (100 / validFiles.length)
          setUploadProgress(Math.round(baseProgress + fileContribution))
        }

        await new Promise<void>((resolve, reject) => {
          uploadFileWithXHR(
            file,
            onFileProgress,
            (res) => {
              uploadedResults.push(res)
              resolve()
            },
            (err) => {
              reject(new Error(`Failed to upload ${file.name}: ${err}`))
            }
          )
        })
      }

      setUploadedFilesList((prev) => [...prev, ...uploadedResults])
      toast.success(`Successfully uploaded ${validFiles.length} file(s)!`)
    } catch (err: any) {
      toast.error(err.message || "Failed to upload one or more files.")
    } finally {
      setIsUploading(false)
      if (singleFileRef.current) singleFileRef.current.value = ""
    }
  }

  const handleLibraryFileSelect = async (file: File) => {
    if (role === "admin" && !selectedClientId) {
      toast.error("Please select a client before uploading files.")
      return
    }

    const check = validateFile(file)
    if (!check.isValid) {
      toast.error(check.error || "Invalid file")
      return
    }

    setIsLibraryUploading(true)
    setLibraryUploadProgress(0)

    await uploadFileWithXHR(
      file,
      (progress) => setLibraryUploadProgress(progress),
      (res) => {
        setIsLibraryUploading(false)
        setUploadedLibraryFile(res)
        toast.success("Library uploaded successfully!")
      },
      (err) => {
        setIsLibraryUploading(false)
        toast.error(`Library upload error: ${err}`)
      }
    )
  }

  const handleDeleteUploadedFile = async (fileName: string) => {
    try {
      await fetch(`/api/cases/files?labName=${encodeURIComponent(targetLabName)}&fileName=${encodeURIComponent(fileName)}`, {
        method: "DELETE"
      })
    } catch (e) {
      console.error("Failed to delete local case file:", e)
    }
  }

  const handleSubmit = async () => {
    if (submitCooldown || isSubmitting) return

    if (role === "admin" && !selectedClientId) {
      toast.error("Please select a client.")
      return
    }

    if (isUploading || isLibraryUploading) {
      toast.error("Please wait for all file uploads to complete.")
      return
    }

    // Validation
    const fields = CASE_HIERARCHY[category as keyof typeof CASE_HIERARCHY]?.fields || []
    const allFieldsFilled = fields.every((f) => f.optional || subTypeData[f.name])
    const teethValid = teeth.length > 0
    const implantCrownBridgeValid = category === "Implant" && subTypeData.caseType2 !== "None" ? crownBridgeTeeth.length > 0 : true

    if (!allFieldsFilled || !teethValid || uploadedFilesList.length === 0 || !implantCrownBridgeValid) {
      toast.error("Please complete all fields, select teeth, and upload at least one file.")
      return
    }

    if (preferredTeethLibrary === "other" && !uploadedLibraryFile) {
      toast.error("Please upload your custom teeth library file.")
      return
    }

    setIsSubmitting(true)
    setSubmitCooldown(true)
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current)
    }
    cooldownTimerRef.current = setTimeout(() => {
      setSubmitCooldown(false)
    }, 5000)

    const formData = new FormData()
    const caseData = {
      clientId: role === "admin" ? selectedClientId : undefined,
      category,
      subTypeData: {
        ...subTypeData,
        modelRequired,
        notes,
        teeth,
        toothSystem,
        ...(category === "Implant" && subTypeData.caseType2 !== "None" ? { crownBridgeTeeth } : {}),
      },
      caseNumber: generatedCaseId,
      uploadedFile: uploadedFilesList[0] || null,
      uploadedFiles: uploadedFilesList,
      preferredTeethLibrary,
      teethLibraryFileUrl: uploadedLibraryFile?.fileUrl || null,
      teethLibraryFileName: uploadedLibraryFile?.fileName || null
    }

    formData.append("cases", JSON.stringify(caseData))

    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        body: formData
      })

      if (res.ok) {
        toast.success("Case submitted successfully!")
        onOpenChange(false)
        if (onSuccess) onSuccess()
        router.refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to submit case.")
      }
    } catch {
      toast.error("An error occurred during submission.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (isSubmitting || isUploading || isLibraryUploading) return
      onOpenChange(val)
    }}>
      <DialogContent
        className="w-[95vw] sm:w-full sm:max-w-3xl max-h-[85vh] overflow-y-auto bg-white text-gray-900 border border-gray-200 shadow-xl rounded-lg"
        onPointerDownOutside={(e) => {
          if (isSubmitting || isUploading || isLibraryUploading) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isSubmitting || isUploading || isLibraryUploading) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-gray-900">
            {role === "admin" ? "Create New Case (Admin)" : "Submit New Case"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Client Selection (Admin only) */}
          {role === "admin" && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-gray-700">Select Client *</Label>
              <Select
                disabled={isSubmitting || isUploading || isLibraryUploading}
                value={selectedClientId}
                onValueChange={(v) => {
                  setSelectedClientId(v)
                  const client = clients.find(c => c.id === v)
                  setTargetLabName(client?.labName || "Client")
                }}
              >
                <SelectTrigger className="h-9 bg-white border border-gray-300 text-gray-900 rounded-md focus:ring-emerald-500">
                  <SelectValue placeholder="Choose a client..." />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-200 text-gray-900 max-h-60 overflow-y-auto">
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="cursor-pointer hover:bg-gray-100 text-xs">
                      {c.labName ? `${c.labName} (${c.fullName || c.email})` : c.fullName || c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Case File Dropzone */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-gray-700">Case Files *</Label>
            <input
              ref={singleFileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : []
                if (files.length > 0) handleMultipleFilesSelect(files)
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
            ) : uploadedFilesList.length > 0 ? (
              <div className="space-y-3">
                <div className="max-h-60 overflow-y-auto border border-emerald-500/20 bg-emerald-500/5 rounded-lg p-2 space-y-1.5 custom-scrollbar">
                  {uploadedFilesList.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-white/80 border border-zinc-100 rounded-md shadow-sm gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-1.5 bg-emerald-500/10 text-emerald-600 rounded shrink-0">
                          <FileArchive className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-zinc-800 truncate max-w-[250px] md:max-w-[400px]">
                            {file.fileName}
                          </p>
                          <p className="text-[10px] text-zinc-500">
                            {(file.fileSize / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={isSubmitting || isUploading}
                        onClick={async (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          await handleDeleteUploadedFile(file.fileName)
                          setUploadedFilesList((prev) => prev.filter((_, i) => i !== idx))
                        }}
                        className="h-7 w-7 text-zinc-400 hover:text-red-500 hover:bg-red-50 shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSubmitting || isUploading}
                    onClick={() => singleFileRef.current?.click()}
                    className="h-8 text-xs flex items-center gap-1.5 bg-white hover:bg-zinc-50 border-zinc-200"
                  >
                    <Upload className="h-3 w-3" /> Add Files
                  </Button>
                </div>
              </div>
            ) : (
              <div
                onDragEnter={handleCaseFileDrag}
                onDragOver={handleCaseFileDrag}
                onDragLeave={handleCaseFileDrag}
                onDrop={handleCaseFileDrop}
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-all block cursor-pointer ${isDraggingCaseFile
                  ? 'border-emerald-600 bg-emerald-500/10 scale-[1.01] shadow-sm'
                  : 'border-border hover:border-emerald-800'
                  } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div>
                  <Upload className={`h-6 w-6 mx-auto mb-1 transition-transform ${isDraggingCaseFile ? 'text-emerald-600 scale-110' : 'text-muted-foreground'}`} />
                  <p className={`text-sm font-medium transition-colors ${isDraggingCaseFile ? 'text-emerald-700' : 'text-foreground'}`}>
                    {isDraggingCaseFile ? 'Drop files here!' : 'Drop files here or choose upload below'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-3">Scans (STL, PLY, OBJ), Images, Videos, PDFs, ZIPs (Max 5GB)</p>
                  <div className="flex justify-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSubmitting || isUploading}
                      onClick={(e) => {
                        e.stopPropagation()
                        singleFileRef.current?.click()
                      }}
                      className="h-8 text-xs flex items-center gap-1.5 bg-white hover:bg-zinc-50 border-zinc-200"
                    >
                      <Upload className="h-3 w-3" /> Choose Files
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Form Fields */}
          {category === "Implant" ? (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Category</Label>
                <Select disabled={isSubmitting} value={category} onValueChange={(v) => { setCategory(v); setSubTypeData(v === "Implant" ? { caseType2: "None" } : {}); }}>
                  <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900 h-9 rounded-md"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-emerald-800 text-white">
                    {Object.keys(CASE_HIERARCHY).map((cat) => (
                      <SelectItem key={cat} value={cat} className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Sub Type 1</Label>
                <Select
                  disabled={isSubmitting}
                  value={subTypeData["caseType1"] || ""}
                  onValueChange={(v) => setSubTypeData({ ...subTypeData, caseType1: v })}
                >
                  <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900 h-9 rounded-md"><SelectValue placeholder="Select Sub Type 1" /></SelectTrigger>
                  <SelectContent className="bg-emerald-800 text-white">
                    {CASE_HIERARCHY["Implant"].fields[0].options.map((opt) => (
                      <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Tooth Selection ({toothSystem === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})</Label>
                <ToothChart selected={teeth} onChange={setTeeth} system={toothSystem} onChangeSystem={setToothSystem} />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Model Required?</Label>
                <RadioGroup value={modelRequired} onValueChange={setModelRequired} className="flex gap-6 pt-1">
                  <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="m-yes-admin" /><Label htmlFor="m-yes-admin" className="font-normal text-xs">Yes</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem value="no" id="m-no-admin" /><Label htmlFor="m-no-admin" className="font-normal text-xs">No</Label></div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Preferred Teeth Library</Label>
                <Select disabled={isSubmitting} value={preferredTeethLibrary} onValueChange={setPreferredTeethLibrary}>
                  <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900 h-9 rounded-md">
                    <SelectValue placeholder="Select Preferred Teeth Library" />
                  </SelectTrigger>
                  <SelectContent className="bg-emerald-800 text-white">
                    <SelectItem value="default" className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">Default Teeth Library</SelectItem>
                    <SelectItem value="other" className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">Other Teeth Library</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {preferredTeethLibrary === "other" && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-gray-700">Teeth Library File (.dme or .zip, max 2GB)</Label>
                  <input
                    ref={libraryFileRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleLibraryFileSelect(file)
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
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg shadow-sm gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-emerald-500/20 text-emerald-600 rounded-md shrink-0">
                          <FileArchive className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate max-w-[200px] sm:max-w-[280px] lg:max-w-[400px]">
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
                      <div className="flex gap-2 shrink-0 justify-end w-full sm:w-auto">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isSubmitting || isLibraryUploading}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            libraryFileRef.current?.click()
                          }}
                          className="h-9 text-xs flex items-center gap-1.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-600 hover:text-white bg-white font-medium"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Replace
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isSubmitting || isLibraryUploading}
                          onClick={async (e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            await handleDeleteUploadedFile(uploadedLibraryFile.fileName)
                            setUploadedLibraryFile(null)
                          }}
                          className="h-9 w-9 text-zinc-500 hover:text-red-500 hover:bg-red-50"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <label
                      onDragEnter={handleLibraryFileDrag}
                      onDragOver={handleLibraryFileDrag}
                      onDragLeave={handleLibraryFileDrag}
                      onDrop={handleLibraryFileDrop}
                      className={`border-2 border-dashed rounded-lg p-6 text-center transition-all block cursor-pointer ${isDraggingLibraryFile
                        ? 'border-emerald-600 bg-emerald-500/10 scale-[1.01] shadow-sm'
                        : 'border-border hover:border-emerald-800'
                        } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <input
                        type="file"
                        className="hidden"
                        disabled={isSubmitting}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleLibraryFileSelect(file)
                        }}
                      />
                      <div>
                        <Upload className={`h-6 w-6 mx-auto mb-1 transition-transform ${isDraggingLibraryFile ? 'text-emerald-600 scale-110' : 'text-muted-foreground'}`} />
                        <p className={`text-sm font-medium transition-colors ${isDraggingLibraryFile ? 'text-emerald-700' : 'text-foreground'}`}>
                          {isDraggingLibraryFile ? 'Drop file here!' : 'Click or drop to upload Custom Teeth Library'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">ZIP or DME (Max 2GB)</p>
                      </div>
                    </label>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Crown & Bridge type (optional)</Label>
                <Select
                  disabled={isSubmitting}
                  value={subTypeData["caseType2"] || "None"}
                  onValueChange={(v) => {
                    setSubTypeData({ ...subTypeData, caseType2: v })
                    if (v === "None") setCrownBridgeTeeth([])
                  }}
                >
                  <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900 h-9 rounded-md"><SelectValue placeholder="Select Crown & Bridge type" /></SelectTrigger>
                  <SelectContent className="bg-emerald-800 text-white">
                    {CASE_HIERARCHY["Implant"].fields[1].options.map((opt) => (
                      <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {subTypeData.caseType2 && subTypeData.caseType2 !== "None" && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-gray-700">Teeth for Crown & Bridge Selection ({toothSystem === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})</Label>
                  <ToothChart selected={crownBridgeTeeth} onChange={setCrownBridgeTeeth} system={toothSystem} onChangeSystem={setToothSystem} />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-gray-700">Category</Label>
                  <Select disabled={isSubmitting} value={category} onValueChange={(v) => { setCategory(v); setSubTypeData(v === "Implant" ? { caseType2: "None" } : {}); }}>
                    <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900 h-9 rounded-md"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-emerald-800 text-white">
                      {Object.keys(CASE_HIERARCHY).map((cat) => (
                        <SelectItem key={cat} value={cat} className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-gray-700">Model Required?</Label>
                  <RadioGroup value={modelRequired} onValueChange={setModelRequired} className="flex gap-6 pt-1">
                    <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="m-yes-admin" /><Label htmlFor="m-yes-admin" className="font-normal text-xs">Yes</Label></div>
                    <div className="flex items-center gap-2"><RadioGroupItem value="no" id="m-no-admin" /><Label htmlFor="m-no-admin" className="font-normal text-xs">No</Label></div>
                  </RadioGroup>
                </div>
              </div>

              {/* Dynamic Fields */}
              {CASE_HIERARCHY[category as keyof typeof CASE_HIERARCHY]?.fields.map((field) => (
                <div className="space-y-2" key={field.name}>
                  <Label className="text-xs font-semibold text-gray-700">{field.label}</Label>
                  <Select
                    disabled={isSubmitting}
                    value={subTypeData[field.name] || ""}
                    onValueChange={(v) => setSubTypeData({ ...subTypeData, [field.name]: v })}
                  >
                    <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900 h-9 rounded-md"><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
                    <SelectContent className="bg-emerald-800 text-white">
                      {field.options.map((opt) => (
                        <SelectItem key={opt} value={opt} className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Tooth Selection ({toothSystem === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})</Label>
                <ToothChart selected={teeth} onChange={setTeeth} system={toothSystem} onChangeSystem={setToothSystem} />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Preferred Teeth Library</Label>
                <Select disabled={isSubmitting} value={preferredTeethLibrary} onValueChange={setPreferredTeethLibrary}>
                  <SelectTrigger className="bg-emerald-800 text-white hover:bg-emerald-900 h-9 rounded-md">
                    <SelectValue placeholder="Select Preferred Teeth Library" />
                  </SelectTrigger>
                  <SelectContent className="bg-emerald-800 text-white">
                    <SelectItem value="default" className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">Default Teeth Library</SelectItem>
                    <SelectItem value="other" className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer">Other Teeth Library</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {preferredTeethLibrary === "other" && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-gray-700">Teeth Library File (.dme or .zip, max 2GB)</Label>
                  <input
                    ref={libraryFileRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleLibraryFileSelect(file)
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
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg shadow-sm gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-emerald-500/20 text-emerald-600 rounded-md shrink-0">
                          <FileArchive className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate max-w-[200px] sm:max-w-[280px] lg:max-w-[400px]">
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
                      <div className="flex gap-2 shrink-0 justify-end w-full sm:w-auto">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isSubmitting || isLibraryUploading}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            libraryFileRef.current?.click()
                          }}
                          className="h-9 text-xs flex items-center gap-1.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-600 hover:text-white bg-white font-medium"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Replace
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isSubmitting || isLibraryUploading}
                          onClick={async (e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            await handleDeleteUploadedFile(uploadedLibraryFile.fileName)
                            setUploadedLibraryFile(null)
                          }}
                          className="h-9 w-9 text-zinc-500 hover:text-red-500 hover:bg-red-50"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <label className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors block border-border ${isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-emerald-800'}`}>
                      <input
                        type="file"
                        className="hidden"
                        disabled={isSubmitting}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleLibraryFileSelect(file)
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
            <Label className="text-xs font-semibold text-gray-700">Additional Notes (Optionals)</Label>
            <Textarea
              placeholder="Special instructions, shade reference, occlusion notes…"
              value={notes}
              disabled={isSubmitting}
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs"
            />
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
