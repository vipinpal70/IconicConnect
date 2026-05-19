"use client"

import { use } from "react"
import { ClientLayout } from "@/src/components/ClientLayout"
import { CaseDetailView } from "@/src/components/CaseDetailView"

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <CaseDetailView
      caseId={id}
      backHref="/client/cases"
      chatSide="lab"
      shell={(children) => <ClientLayout>{children}</ClientLayout>}
    />
  )
}
