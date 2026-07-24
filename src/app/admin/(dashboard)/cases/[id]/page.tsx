"use client"

import { use } from "react"
import { CaseDetailView } from "@/src/components/CaseDetailView"

export default function AdminCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <CaseDetailView
      caseId={id}
      backHref="/admin/cases"
      chatSide="admin"
      shell={(children) => children}
    />
  )
}
