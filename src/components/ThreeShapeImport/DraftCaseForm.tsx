"use client"

import React from "react"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select"
import { ToothChart } from "@/src/components/ToothChart"
import { CASE_HIERARCHY } from "@/src/lib/case-hierarchy"

export type DraftSubTypeData = Record<string, unknown> & {
  teeth?: number[]
  crownBridgeTeeth?: number[]
  toothSystem?: "USA" | "FDI"
  modelRequired?: "yes" | "no" | null
  notes?: string
}

interface DraftCaseFormProps {
  category: string | null
  subTypeData: DraftSubTypeData
  /** `subTypeData`-relative field names to flag amber ("needs review"). */
  highlightFields: string[]
  disabled?: boolean
  onCategoryChange: (category: string) => void
  onSubTypeDataChange: (next: DraftSubTypeData) => void
}

const CATEGORIES = Object.keys(CASE_HIERARCHY)

/** A pre-filled, editable case form for one extracted 3Shape draft. */
export function DraftCaseForm({
  category,
  subTypeData,
  highlightFields,
  disabled,
  onCategoryChange,
  onSubTypeDataChange,
}: DraftCaseFormProps) {
  const flagged = new Set(highlightFields)
  const set = (patch: DraftSubTypeData) => onSubTypeDataChange({ ...subTypeData, ...patch })
  const teeth = Array.isArray(subTypeData.teeth) ? subTypeData.teeth : []
  const crownBridgeTeeth = Array.isArray(subTypeData.crownBridgeTeeth)
    ? subTypeData.crownBridgeTeeth
    : []
  const system = subTypeData.toothSystem === "FDI" ? "FDI" : "USA"

  const ring = (name: string) =>
    flagged.has(name) ? "ring-2 ring-amber-400/70 rounded-md" : ""
  // ToothChart has no `disabled` prop — gate interaction at the wrapper.
  const toothWrap = (name: string) =>
    `${ring(name)} ${disabled ? "pointer-events-none opacity-60" : ""}`.trim()

  const fields = category ? CASE_HIERARCHY[category]?.fields ?? [] : []
  const isImplant = category === "Implant"
  // No "3D Model" category on this branch — always false, so `showTeeth`
  // below is unconditionally true (teeth are required for every category).
  const isModel = category === "3D Model"
  const die = subTypeData.die === "Yes"
  const caseType2 = typeof subTypeData.caseType2 === "string" ? subTypeData.caseType2 : ""
  const showTeeth = !isModel || die
  const showCrownBridgeTeeth = isImplant && caseType2 !== "" && caseType2 !== "None"

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-700">Category</Label>
          <div className={ring("category")}>
            <Select
              disabled={disabled}
              value={category ?? ""}
              onValueChange={(v) => onCategoryChange(v)}
            >
              <SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900 rounded-md">
                <SelectValue placeholder="Select a category…" />
              </SelectTrigger>
              <SelectContent className="bg-emerald-800 text-white">
                {CATEGORIES.map((c) => (
                  <SelectItem
                    key={c}
                    value={c}
                    className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer"
                  >
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!isModel && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-700">Model Required? *</Label>
            <RadioGroup
              value={
                subTypeData.modelRequired === "yes" || subTypeData.modelRequired === "no"
                  ? subTypeData.modelRequired
                  : undefined
              }
              onValueChange={(v) => set({ modelRequired: v as "yes" | "no" })}
              className="flex gap-6 pt-1.5"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="yes" id="ts-mr-yes" disabled={disabled} />
                <Label htmlFor="ts-mr-yes" className="font-normal text-xs">Yes</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="no" id="ts-mr-no" disabled={disabled} />
                <Label htmlFor="ts-mr-no" className="font-normal text-xs">No</Label>
              </div>
            </RadioGroup>
          </div>
        )}
      </div>

      {fields.map((field) => (
        <div className="space-y-1.5" key={field.name}>
          <Label className="text-xs font-semibold text-gray-700">
            {field.label}{!field.optional && " *"}
            {flagged.has(field.name) && (
              <span className="ml-1.5 text-[10px] font-medium text-amber-600">needs review</span>
            )}
          </Label>
          <div className={ring(field.name)}>
            <Select
              disabled={disabled}
              value={typeof subTypeData[field.name] === "string" ? (subTypeData[field.name] as string) : ""}
              onValueChange={(v) => {
                const patch: DraftSubTypeData = { [field.name]: v }
                if (field.name === "caseType2" && isImplant && v === "None") patch.crownBridgeTeeth = []
                if (field.name === "die" && v !== "Yes") patch.teeth = []
                set(patch)
              }}
            >
              <SelectTrigger className="h-9 bg-emerald-800 text-white hover:bg-emerald-900 rounded-md">
                <SelectValue placeholder={`Select ${field.label}`} />
              </SelectTrigger>
              <SelectContent className="bg-emerald-800 text-white">
                {field.options.map((opt) => (
                  <SelectItem
                    key={opt}
                    value={opt}
                    className="focus:bg-emerald-700 focus:text-white text-xs cursor-pointer"
                  >
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ))}

      {showTeeth && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-700">
            {isModel ? "Die Selection" : "Tooth Selection"} (
            {system === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})
            {flagged.has("teeth") && (
              <span className="ml-1.5 text-[10px] font-medium text-amber-600">needs review</span>
            )}
          </Label>
          <div className={toothWrap("teeth")}>
            <ToothChart
              selected={teeth}
              onChange={(t) => set({ teeth: t })}
              system={system}
              onChangeSystem={(sys) => set({ toothSystem: sys })}
            />
          </div>
        </div>
      )}

      {showCrownBridgeTeeth && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-700">
            Teeth for Crown &amp; Bridge (
            {system === "USA" ? "USA Universal Numbering" : "FDI Numbering System"})
            {flagged.has("crownBridgeTeeth") && (
              <span className="ml-1.5 text-[10px] font-medium text-amber-600">needs review</span>
            )}
          </Label>
          <div className={toothWrap("crownBridgeTeeth")}>
            <ToothChart
              selected={crownBridgeTeeth}
              onChange={(t) => set({ crownBridgeTeeth: t })}
              system={system}
              onChangeSystem={(sys) => set({ toothSystem: sys })}
            />
          </div>
          {crownBridgeTeeth.length === 0 && (
            <p className="text-[11px] text-amber-600">
              Not required to submit, but the design team will need this — consider selecting the
              attachment teeth before sending.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-gray-700">Notes</Label>
        <Textarea
          disabled={disabled}
          value={typeof subTypeData.notes === "string" ? subTypeData.notes : ""}
          onChange={(e) => set({ notes: e.target.value })}
          className="text-xs min-h-[120px]"
        />
      </div>
    </div>
  )
}
