"use client"

import { use } from "react"
import { AdminLayout } from "@/src/components/AdminLayout"
import { CaseDetailView } from "@/src/components/CaseDetailView"

export default function AdminCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <CaseDetailView
      caseId={id}
      backHref="/admin/cases"
      chatSide="admin"
      shell={(children) => <AdminLayout>{children}</AdminLayout>}
    />
  )
}
