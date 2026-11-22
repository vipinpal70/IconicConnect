import { Suspense } from 'react'
import { SupportWorkspace } from '@/src/components/support/SupportWorkspace'

/** Support inbox for QC and account managers (support-system.md §9). */
export default function OpsSupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportWorkspace mode="agent" />
    </Suspense>
  )
}
