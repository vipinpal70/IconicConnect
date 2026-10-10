"use client"

import { Suspense, useEffect, useState } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog"
import { AlertTriangle, SearchX, Users } from "lucide-react"
import { toast } from "sonner"
import { ClientCard, type ClientPaymentSummary, type ClientRow } from "./_components/ClientCard"
import { ClientFilters, type Facets } from "./_components/ClientFilters"
import { ClientPagination } from "./_components/ClientPagination"
import { useClientFilters } from "./_components/useClientFilters"

type ListResponse = { data: ClientRow[]; total: number; page: number; limit: number; pageCount: number; facets: Facets }

const PAGE_SIZE = 24

export default function AdminClients() {
  // useSearchParams() (inside the filter hook) must sit under a Suspense boundary.
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ClientsDirectory />
    </Suspense>
  )
}

function ClientsDirectory() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [onboardOpen, setOnboardOpen] = useState(false)
  const [clientToDelete, setClientToDelete] = useState<ClientRow | null>(null)
  const { filters, update, input, setInput, activeCount, clearAll } = useClientFilters()

  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useQuery<ListResponse>({
    // Key starts with "pendingClients" so the existing invalidations (approve / status / delete / plan) still hit it.
    queryKey: ["pendingClients", "list", filters],
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(filters.page), sort: filters.sort })
      if (filters.q) p.set("q", filters.q)
      if (filters.status) p.set("status", filters.status)
      if (filters.plan) p.set("plan", filters.plan)
      if (filters.payment) p.set("payment", filters.payment)
      const res = await fetch(`/api/admin/clients/list?${p}`, { signal, cache: "no-store" })
      if (!res.ok) throw new Error("Failed to fetch clients")
      return res.json()
    },
    placeholderData: keepPreviousData, // keep showing the old results (dimmed) instead of flashing a spinner
    staleTime: 15_000,
  })

  // If the last client of the last page was deleted/filtered away, step back to a page that exists.
  useEffect(() => {
    if (data && !isPlaceholderData && filters.page > data.pageCount) update({ page: data.pageCount }, true)
  }, [data, isPlaceholderData, filters.page, update])

  const { data: paymentSummary } = useQuery<Record<string, ClientPaymentSummary>>({
    queryKey: ["clientPaymentSummary"],
    queryFn: async () => {
      const res = await fetch("/api/admin/invoices/client-payments")
      if (!res.ok) return {}
      return res.json()
    },
    staleTime: 60_000,
  })

  const approveMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const res = await fetch("/api/admin/clients/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      })
      if (!res.ok) throw new Error("Failed to approve client")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pendingClients"] })
      toast.success("Client approved successfully")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "inactive" }) => {
      const res = await fetch(`/api/admin/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to update client status")
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pendingClients"] })
      toast.success(variables.status === "active" ? "Client reactivated" : "Client deactivated")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/clients/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to delete client")
      }
      return res.json()
    },
    onSuccess: (d: { warning?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["pendingClients"] })
      setClientToDelete(null)
      if (d?.warning) toast.warning(d.warning)
      else toast.success("Client deleted")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) return <LoadingSpinner />
  if (error && !data) return <ErrorMessage message={(error as Error).message} />

  const total = data?.total ?? 0
  const from = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1
  const to = Math.min(filters.page * PAGE_SIZE, total)

  return (
      <div className="space-y-4 animate-fade-in">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold text-foreground">Clients</h1>
          <p className="text-xs text-muted-foreground">Review registrations, manage profiles and price lists</p>
        </div>

        <ClientFilters
          filters={filters}
          input={input}
          onInput={setInput}
          onChange={(patch) => update(patch)}
          onClear={clearAll}
          activeCount={activeCount}
          facets={data?.facets}
          onRefresh={() => { queryClient.invalidateQueries({ queryKey: ["clientPaymentSummary"] }); refetch() }}
          refreshing={isFetching}
        />

        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {total === 0 ? "No clients" : <>Showing <span className="font-semibold text-foreground">{from}–{to}</span> of <span className="font-semibold text-foreground">{total}</span> client{total === 1 ? "" : "s"}</>}
          {activeCount > 0 && total > 0 ? " matching your filters" : ""}
        </p>

        {data && data.data.length === 0 ? (
          <EmptyState filtered={activeCount > 0} onClear={clearAll} />
        ) : (
          <div
            className={`grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 ${isPlaceholderData ? "opacity-60" : ""}`}
            aria-busy={isPlaceholderData}
          >
            {data?.data.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                payment={paymentSummary?.[client.id]}
                statusBusy={statusMutation.isPending}
                approveBusy={approveMutation.isPending}
                deleteBusy={deleteMutation.isPending}
                onOpen={() => router.push(`/admin/clients/${client.id}`)}
                onApprove={() => approveMutation.mutate(client.id)}
                onSetStatus={(status) => statusMutation.mutate({ id: client.id, status })}
                onDelete={() => setClientToDelete(client)}
              />
            ))}
          </div>
        )}

        <ClientPagination page={filters.page} pageCount={data?.pageCount ?? 1} onPage={(p) => { update({ page: p }, true); window.scrollTo({ top: 0, behavior: "smooth" }) }} />

        <Dialog open={onboardOpen} onOpenChange={setOnboardOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Onboard New Client</DialogTitle>
            </DialogHeader>
            <div className="mt-2 space-y-4">
              <div className="space-y-2">
                <Label>Company / Lab Name</Label>
                <Input placeholder="PrecisionDent Lab" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>POC Name</Label>
                  <Input placeholder="Daniel Ortega" />
                </div>
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input placeholder="Miami" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" placeholder="daniel@lab.com" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input placeholder="+1..." />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea placeholder="Special preferences..." />
              </div>
              <Button
                className="w-full border-none shadow-glow gradient-primary"
                onClick={() => {
                  toast.info("Manual onboarding is restricted. Please use the Admin Sign-up link.")
                  setOnboardOpen(false)
                }}
              >
                Send Invitation
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!clientToDelete} onOpenChange={(open) => !open && setClientToDelete(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4" />
                Delete this client permanently?
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-xs text-muted-foreground">
              <p>
                This will permanently delete{" "}
                <span className="font-semibold text-foreground">
                  {clientToDelete?.labName || clientToDelete?.fullName || clientToDelete?.email}
                </span>{" "}
                and cannot be undone, including:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Their login and every sub-user login under this lab</li>
                <li>All cases, uploaded files, and chat/message history</li>
                <li>Invoices and their price list</li>
                <li>Support tickets and callback requests</li>
                <li>Notifications and activity history</li>
              </ul>
              <p>
                If you only want to block their access while keeping their history, use{" "}
                <span className="font-medium text-foreground">Deactivate</span> instead.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setClientToDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                disabled={deleteMutation.isPending}
                onClick={() => clientToDelete && deleteMutation.mutate(clientToDelete.id)}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

  )
}

function EmptyState({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  const Icon = filtered ? SearchX : Users
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <Icon className="mb-3 h-8 w-8 text-muted-foreground/60" />
      <p className="text-sm font-semibold text-foreground">{filtered ? "No clients match your filters" : "No clients yet"}</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        {filtered ? "Try a different search term or remove some filters." : "New lab registrations will appear here for approval."}
      </p>
      {filtered && <Button variant="outline" size="sm" className="mt-4 h-8 text-xs" onClick={onClear}>Clear all filters</Button>}
    </div>
  )
}

function LoadingSpinner() {
  return (
    
      <div className="flex h-[60vh] items-center justify-center">
        <div className="relative flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 border-primary" />
          <div className="absolute h-8 w-8 animate-pulse rounded-full bg-primary/10" />
        </div>
      </div>
    
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    
      <div className="flex h-[60vh] items-center justify-center p-4">
        <div className="max-w-md rounded-2xl border border-red-100 bg-red-50 p-6 text-center shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-red-900">Error Loading Clients</h3>
          <p className="text-sm text-red-700">{message}</p>
        </div>
      </div>
    
  )
}
