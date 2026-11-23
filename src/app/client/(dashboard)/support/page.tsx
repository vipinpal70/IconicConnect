import { Suspense } from 'react'
import { SupportWorkspace } from '@/src/components/support/SupportWorkspace'

/** Lab support: conversations with the support team (support-system.md §9). */
export default function ClientSupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportWorkspace mode="customer" />
    </Suspense>
  )
}
