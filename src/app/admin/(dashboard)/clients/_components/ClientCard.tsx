"use client"

import { format } from "date-fns"
import { Card, CardContent } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/src/components/ui/dropdown-menu"
import {
  Building2, Mail, Phone, MapPin, ShieldCheck, ArrowRight, CircleCheck, CircleX, MoreVertical, UserX, UserCheck, Trash2,
} from "lucide-react"

export type ClientRow = {
  id: string
  fullName: string | null
  email: string
  labName: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: "pending" | "active" | "inactive"
  plan: "trial" | "onboarded" | null
  createdAt: string
}

export type ClientPaymentSummary = {
  clientId: string
  invoiceId: string
  invoiceNumber: string
  clientPaid: boolean
  clientPaymentDate: string | null
  received: boolean
  pendingCount: number
  totalInvoices: number
}

const PLAN_LABEL = { trial: "Trial", onboarded: "Onboarded" } as const
const PLAN_STYLE = {
  trial: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  onboarded: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
} as const

function StatusBadge({ client }: { client: ClientRow }) {
  if (client.status === "pending")
    return <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-600">Pending approval</Badge>
  if (client.status === "inactive")
    return <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] border-red-500/20 bg-red-500/10 text-red-600">Inactive</Badge>
  const plan = client.plan ?? "trial"
  return <Badge variant="outline" className={`h-5 shrink-0 px-1.5 text-[10px] ${PLAN_STYLE[plan]}`}>{PLAN_LABEL[plan]}</Badge>
}

type Props = {
  client: ClientRow
  payment?: ClientPaymentSummary
  statusBusy: boolean
  approveBusy: boolean
  deleteBusy: boolean
  onOpen: () => void
  onApprove: () => void
  onSetStatus: (status: "active" | "inactive") => void
  onDelete: () => void
}

export function ClientCard({ client, payment, statusBusy, approveBusy, deleteBusy, onOpen, onApprove, onSetStatus, onDelete }: Props) {
  return (
    <Card
      className="group cursor-pointer border-border/50 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-sm"
      role="button"
      tabIndex={0}
      aria-label={`Open ${client.labName || client.fullName || "client"}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return // ignore keys pressed on inner buttons / menu
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <CardContent className="space-y-3 p-3.5">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
              {client.labName?.charAt(0) || client.fullName?.charAt(0) || <Building2 className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800 group-hover:text-primary">{client.labName || "No Lab Name"}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <StatusBadge client={client} />
                <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">{client.id.slice(0, 8)}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Client actions" onClick={(e) => e.stopPropagation()}>
                  <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 text-xs" onClick={(e) => e.stopPropagation()}>
                {client.status === "inactive" ? (
                  <DropdownMenuItem className="gap-1.5 text-xs" disabled={statusBusy} onClick={() => onSetStatus("active")}>
                    <UserCheck className="h-3.5 w-3.5" /> Reactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="gap-1.5 text-xs" disabled={statusBusy} onClick={() => onSetStatus("inactive")}>
                    <UserX className="h-3.5 w-3.5" /> Deactivate
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-1.5 text-xs text-red-500 hover:text-red-600 focus:bg-red-50 focus:text-red-600"
                  disabled={deleteBusy}
                  onClick={onDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 text-primary/60" />
            <span className="truncate">{client.city || "No City"}, {client.state || "No State"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3 w-3 text-primary/60" />
            <span className="truncate">{client.email}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="h-3 w-3 text-primary/60" />
            <span>{client.phone || "No Phone"}</span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[10px]">
          <span className="text-muted-foreground">POC: <span className="font-semibold text-slate-700">{client.fullName || "-"}</span></span>
          <span className="text-muted-foreground">Reg: <span className="font-semibold text-slate-700">{format(new Date(client.createdAt), "MMM dd, yyyy")}</span></span>
        </div>

        {payment ? (
          <div className="flex items-center justify-between border-t border-border/50 pt-1.5 text-[10px]">
            {payment.clientPaid ? (
              <div className="flex items-center gap-1 text-green-600">
                <CircleCheck className="h-3.5 w-3.5 text-green-500" />
                <span className="font-semibold">
                  {payment.clientPaymentDate
                    ? `Paid ${new Date(payment.clientPaymentDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : "Latest Paid"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-red-500">
                <CircleX className="h-3.5 w-3.5 text-red-400" />
                <span className="font-semibold">{payment.pendingCount > 1 ? `${payment.pendingCount} unpaid` : "Unpaid"}</span>
              </div>
            )}
            <span className="text-muted-foreground">{payment.totalInvoices} invoice{payment.totalInvoices !== 1 ? "s" : ""}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between pt-1 text-[10px] font-semibold text-primary">
          <span>Open client profile</span>
          <ArrowRight className="h-3 w-3" />
        </div>

        {client.status === "pending" && (
          <Button
            className="mt-1.5 h-7 w-full gap-1.5 text-[10px]"
            onClick={(e) => { e.stopPropagation(); onApprove() }}
            disabled={approveBusy}
          >
            <ShieldCheck className="h-3 w-3" /> Approve Registration
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
