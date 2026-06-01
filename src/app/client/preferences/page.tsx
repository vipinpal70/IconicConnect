"use client"

import { useEffect, useMemo, useState } from "react"
import { ClientLayout } from "@/src/components/ClientLayout"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent } from "@/src/components/ui/card"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Badge } from "@/src/components/ui/badge"
import { createClient } from "@/src/lib/supabase/client"
import {
  anatomyOptions,
  clonePreferenceFormPayload,
  createPreferenceFormDefaults,
  ponticDistanceOptions,
  ponticTypeOptions,
  smileLibraryOptions,
  yesNoOptions,
} from "@/src/lib/preference-forms"
import type { PreferenceFormPayload, PreferenceFormRecord } from "@/src/lib/preference-forms"
import { Plus, PencilLine, Trash2 } from "lucide-react"
import { preferenceForms } from "@/src/db/schema"

type Profile = {
  id: string
  fullName?: string
  labName?: string
  role?: string
}

type FormState = {
  formName: string
  payload: PreferenceFormPayload
}

const emptyForm = (): FormState => ({
  formName: "",
  payload: createPreferenceFormDefaults(),
})

export default function ClientPreferencesPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [forms, setForms] = useState<PreferenceFormRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<FormState>(emptyForm)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          setLoading(false)
          return
        }

        const [profileRes, formsRes] = await Promise.all([
          fetch("/api/profile"),
          fetch("/api/preference-forms", { cache: "no-store" }),
        ])

        if (profileRes.ok) {
          const profileData = await profileRes.json().catch(() => null)
          setProfile(profileData)
        }

        if (formsRes.ok) {
          const formsData = await formsRes.json().catch(() => null)
          setForms(formsData?.data ?? [])
        }
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const headerName = useMemo(() => profile?.labName || profile?.fullName || "Preference Forms", [profile])

  const saveForm = async () => {
    if (!draft.formName.trim()) {
      return
    }

    setSaving(true)
    try {
      const endpoint = editingId ? `/api/preference-forms/${editingId}` : "/api/preference-forms"
      const res = await fetch(endpoint, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formName: draft.formName,
          payload: draft.payload,
        }),
      })

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null)
        throw new Error(errorBody?.error || `Failed to save preference form (${res.status})`)
      }

      const nextRes = await fetch("/api/preference-forms", { cache: "no-store" })
      if (nextRes.ok) {
        const nextData = await nextRes.json().catch(() => null)
        setForms(nextData?.data ?? [])
      }

      setDraft(emptyForm())
      setEditingId(null)
    } catch (error) {
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const editForm = (form: PreferenceFormRecord) => {
    setEditingId(form.id)
    setDraft({
      formName: form.formName,
      payload: clonePreferenceFormPayload(form.payload),
    })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const deleteForm = async (id: string) => {
    if (!window.confirm("Delete this preference form?")) return

    const res = await fetch(`/api/preference-forms/${id}`, { method: "DELETE" })
    if (!res.ok) return

    setForms((current) => current.filter((form) => form.id !== id))
    if (editingId === id) {
      setDraft(emptyForm())
      setEditingId(null)
    }
  }

  const updatePayload = <K extends keyof PreferenceFormPayload>(
    key: K,
    value: PreferenceFormPayload[K]
  ) => {
    setDraft((current) => ({
      ...current,
      payload: {
        ...current.payload,
        [key]: value,
      },
    }))
  }

  return (
    <ClientLayout>
      <div className="mx-auto max-w-5xl space-y-4 animate-fade-in">
        <div className="flex flex-col gap-1.5 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{headerName}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Create, edit, and manage multiple preference forms linked to your account.</p>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-1.5 h-8 text-xs w-fit" 
            onClick={() => {
              setDraft(emptyForm())
              setEditingId(null)
              document.getElementById("preference-form")?.scrollIntoView({ behavior: "smooth" })
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New Form
          </Button>
        </div>

        <Card className="shadow-card border-border/50">
          <CardContent className="p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground">Saved Forms</h3>
                <p className="text-[11px] text-muted-foreground">Forms are stored under your account and visible to the admin team.</p>
              </div>
              <Badge variant="secondary" className="text-[10px] scale-95">{loading ? "Loading..." : `${forms.length} form(s)`}</Badge>
            </div>

            {forms.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No preference forms have been added yet.</p>
            ) : (
              <div className="grid gap-3">
                {forms.map((form) => (
                  <Card key={form.id} className="border-border/50 bg-muted/[0.02]">
                    <CardContent className="p-3 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-bold text-xs text-foreground">{form.formName}</h4>
                          <p className="text-[10px] text-muted-foreground">Created {new Date(form.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => editForm(form)}>
                            <PencilLine className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => deleteForm(form.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-2 text-xs md:grid-cols-2">
                        <Summary label="Occlusion" value={form.payload.occlusion.defaultValues || "-"} />
                        <Summary label="Proximal Contacts" value={form.payload.proximalContacts.defaultValues || "-"} />
                        <Summary label="Distal-most Crown" value={form.payload.distalMostCrownContact.defaultValues || "-"} />
                        <Summary label="Anatomy" value={form.payload.anatomy.option || "-"} />
                        <Summary label="Smile Library" value={form.payload.smileLibrary.option || "-"} />
                        <Summary label="Pontic Type" value={form.payload.ponticType.option || "-"} />
                        <Summary label="Pontic Distance" value={form.payload.ponticDistanceFromTissue.option || "-"} />
                        <Summary label="Match Marginal Ridge" value={form.payload.matchMarginalRidge.option || "-"} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="preference-form" className="overflow-hidden border-border/50 shadow-sm bg-white">
          <CardContent className="p-0">
            <div className="border-b border-border/50 px-4 py-2.5 bg-muted/20">
              <h2 className="text-sm font-semibold text-muted-foreground">Full Contour Form</h2>
              <p className="text-[10px] text-muted-foreground">
                {editingId ? "Editing preference form" : "Add a new preference form"}
              </p>
            </div>

            <div className="p-4 space-y-3.5">
              <Section label="Form Name *">
                <Input
                  className="h-8 text-xs"
                  value={draft.formName}
                  onChange={(e) => setDraft((current) => ({ ...current, formName: e.target.value }))}
                  placeholder="form name"
                />
              </Section>

              <Section label="Occlusion">
                <div className="grid gap-2">
                  <Input
                    className="h-8 text-xs"
                    value={draft.payload.occlusion.defaultValues}
                    onChange={(e) => updatePayload("occlusion", { ...draft.payload.occlusion, defaultValues: e.target.value })}
                    placeholder="Default Values"
                  />
                  <Input
                    className="h-8 text-xs"
                    value={draft.payload.occlusion.comments}
                    onChange={(e) => updatePayload("occlusion", { ...draft.payload.occlusion, comments: e.target.value })}
                    placeholder="Comments"
                  />
                </div>
              </Section>

              <Section label="Proximal Contacts">
                <div className="grid gap-2">
                  <Input
                    className="h-8 text-xs"
                    value={draft.payload.proximalContacts.defaultValues}
                    onChange={(e) => updatePayload("proximalContacts", { ...draft.payload.proximalContacts, defaultValues: e.target.value })}
                    placeholder="Default Values"
                  />
                  <Input
                    className="h-8 text-xs"
                    value={draft.payload.proximalContacts.comments}
                    onChange={(e) => updatePayload("proximalContacts", { ...draft.payload.proximalContacts, comments: e.target.value })}
                    placeholder="Comments"
                  />
                </div>
              </Section>

              <Section label="Contact for Distal-most Crown">
                <div className="grid gap-2">
                  <Input
                    className="h-8 text-xs"
                    value={draft.payload.distalMostCrownContact.defaultValues}
                    onChange={(e) => updatePayload("distalMostCrownContact", { ...draft.payload.distalMostCrownContact, defaultValues: e.target.value })}
                    placeholder="Default Values"
                  />
                  <Input
                    className="h-8 text-xs"
                    value={draft.payload.distalMostCrownContact.comments}
                    onChange={(e) => updatePayload("distalMostCrownContact", { ...draft.payload.distalMostCrownContact, comments: e.target.value })}
                    placeholder="Comments"
                  />
                </div>
              </Section>

              <Section label="Anatomy">
                <ChoiceRow
                  name="anatomy"
                  value={draft.payload.anatomy.option}
                  options={anatomyOptions}
                  onChange={(option) => updatePayload("anatomy", { ...draft.payload.anatomy, option })}
                />
                <Input
                  className="h-8 text-xs mt-1"
                  value={draft.payload.anatomy.comments}
                  onChange={(e) => updatePayload("anatomy", { ...draft.payload.anatomy, comments: e.target.value })}
                  placeholder="Comments"
                />
              </Section>

              <Section label="Smile Library">
                <ChoiceRow
                  name="smile-library"
                  value={draft.payload.smileLibrary.option}
                  options={smileLibraryOptions}
                  onChange={(option) => updatePayload("smileLibrary", { ...draft.payload.smileLibrary, option })}
                />
                <Input
                  className="h-8 text-xs mt-1"
                  value={draft.payload.smileLibrary.libraryName}
                  onChange={(e) => updatePayload("smileLibrary", { ...draft.payload.smileLibrary, libraryName: e.target.value })}
                  placeholder="Name of Library"
                />
                <Input
                  className="h-8 text-xs mt-1.5"
                  value={draft.payload.smileLibrary.comments}
                  onChange={(e) => updatePayload("smileLibrary", { ...draft.payload.smileLibrary, comments: e.target.value })}
                  placeholder="Comments"
                />
              </Section>

              <Section label="Pontic Type">
                <ChoiceRow
                  name="pontic-type"
                  value={draft.payload.ponticType.option}
                  options={ponticTypeOptions}
                  onChange={(option) => updatePayload("ponticType", { ...draft.payload.ponticType, option })}
                />
                <Input
                  className="h-8 text-xs mt-1"
                  value={draft.payload.ponticType.comments}
                  onChange={(e) => updatePayload("ponticType", { ...draft.payload.ponticType, comments: e.target.value })}
                  placeholder="Comments"
                />
              </Section>

              <Section label="Pontic Distance From Tissue">
                <ChoiceRow
                  name="pontic-distance"
                  value={draft.payload.ponticDistanceFromTissue.option}
                  options={ponticDistanceOptions}
                  onChange={(option) => updatePayload("ponticDistanceFromTissue", { ...draft.payload.ponticDistanceFromTissue, option })}
                />
                <Input
                  className="h-8 text-xs mt-1"
                  value={draft.payload.ponticDistanceFromTissue.comments}
                  onChange={(e) => updatePayload("ponticDistanceFromTissue", { ...draft.payload.ponticDistanceFromTissue, comments: e.target.value })}
                  placeholder="Comments"
                />
                <Input
                  className="h-8 text-xs mt-1.5"
                  value={draft.payload.ponticDistanceFromTissue.distanceMm}
                  onChange={(e) => updatePayload("ponticDistanceFromTissue", { ...draft.payload.ponticDistanceFromTissue, distanceMm: e.target.value })}
                  placeholder="Distance (mm)"
                />
              </Section>

              <Section label="Match Marginal Ridge to Occlusal of Opposing">
                <ChoiceRow
                  name="match-marginal-ridge"
                  value={draft.payload.matchMarginalRidge.option}
                  options={yesNoOptions}
                  onChange={(option) => updatePayload("matchMarginalRidge", { ...draft.payload.matchMarginalRidge, option })}
                />
                <Input
                  className="h-8 text-xs mt-1"
                  value={draft.payload.matchMarginalRidge.comments}
                  onChange={(e) => updatePayload("matchMarginalRidge", { ...draft.payload.matchMarginalRidge, comments: e.target.value })}
                  placeholder="Comments"
                />
              </Section>

              <div className="pt-2">
                <Button onClick={saveForm} disabled={saving} size="sm" className="gap-1.5 h-8 text-xs">
                  {editingId ? <PencilLine className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {editingId ? "Update Form" : "Save Form"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>


      </div>
    </ClientLayout>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function ChoiceRow<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string
  value: T | ""
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {options.map((option) => (
        <label key={option} className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
            className="h-3 w-3 border-border text-primary focus:ring-primary"
          />
          <span className="text-foreground">{option}</span>
        </label>
      ))}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/50 bg-muted/20 px-2.5 py-1.5">
      <p className="text-[9px] font-bold tracking-wider text-muted-foreground">{label}</p>
      <p className="truncate text-[11px] text-foreground font-semibold mt-0.5">{value}</p>
    </div>
  )
}
