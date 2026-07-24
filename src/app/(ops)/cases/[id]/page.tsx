"use client"

import { use } from "react"
import { OpsLayout } from "@/src/components/OpsLayout"
import { CaseDetailView } from "@/src/components/CaseDetailView"

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <CaseDetailView
      caseId={id}
      backHref="/cases"
      chatSide="admin"
      shell={(children) => <OpsLayout>{children}</OpsLayout>}
    />
  )
}
