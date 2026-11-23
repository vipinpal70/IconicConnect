import { Suspense } from 'react'
import { SupportWorkspace } from '@/src/components/support/SupportWorkspace'

/** Support inbox for admins (support-system.md §9). */
export default function AdminSupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportWorkspace mode="agent" />
    </Suspense>
  )
}
