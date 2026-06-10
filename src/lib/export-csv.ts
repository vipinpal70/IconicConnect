function escapeCell(value: string | null | undefined): string {
  const str = value == null ? "" : String(value)
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function downloadCSV(headers: string[], rows: string[][], filename: string) {
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ]
  // UTF-8 BOM so Excel opens it correctly
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export type CaseTeethInfo = {
  /** Formatted tooth numbers or arch selection, e.g. "#11, #12" or "Upper Arch" */
  selection: string
  /** Quantity with unit label, e.g. "3 teeth" | "2 arches" | "1 case" */
  unitCount: string
  /** Numbering system, e.g. "Universal (USA)" | "FDI" | "—" for arch-based */
  numberingSystem: string
}

export function extractCaseTeethInfo(
  category: string | null | undefined,
  subTypeData: Record<string, unknown> | null | undefined
): CaseTeethInfo {
  const d = subTypeData ?? {}
  const cat = (category ?? "").toLowerCase().trim()
  const toothSystem = String(d.toothSystem ?? "USA")
  const numberingLabel =
    cat === "crown & bridge" || cat === "crown & bridges" || cat === "implant" || cat === "implants"
      ? toothSystem === "FDI" ? "FDI" : "Universal (USA)"
      : "—"

  if (cat === "crown & bridge" || cat === "crown & bridges") {
    const teeth = Array.isArray(d.teeth) ? (d.teeth as number[]) : []
    return {
      selection: teeth.length ? teeth.map((t) => `#${t}`).join(", ") : "—",
      unitCount: teeth.length ? `${teeth.length} tooth` : "—",
      numberingSystem: numberingLabel,
    }
  }

  if (cat === "implant" || cat === "implants") {
    const impTeeth = Array.isArray(d.teeth) ? (d.teeth as number[]) : []
    const cbTeeth = Array.isArray(d.crownBridgeTeeth) ? (d.crownBridgeTeeth as number[]) : []
    const parts: string[] = [
      ...impTeeth.map((t) => `Imp:#${t}`),
      ...cbTeeth.map((t) => `CB:#${t}`),
    ]
    const total = impTeeth.length + cbTeeth.length
    return {
      selection: parts.length ? parts.join(", ") : "—",
      unitCount: total ? `${total} tooth` : "—",
      numberingSystem: numberingLabel,
    }
  }

  // Arch-based: Appliances, Dentures, Cosmetics
  if (
    cat === "appliance" || cat === "appliances" ||
    cat === "denture" || cat === "dentures" ||
    cat === "cosmetic" || cat === "cosmetics"
  ) {
    const archRaw = String(d.arch || d.caseType2 || "Upper")
    const archLower = archRaw.toLowerCase()
    const archCount = archLower.includes("both") || archLower.includes("full") ? 2 : 1
    return {
      selection: `${archRaw} Arch`,
      unitCount: `${archCount} arch`,
      numberingSystem: "—",
    }
  }

  // Model / per-case or unknown
  return { selection: "—", unitCount: "1 case", numberingSystem: "—" }
}
