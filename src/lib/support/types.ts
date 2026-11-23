import type {
  SupportCategory,
  SupportCloseReason,
  SupportMessageKind,
  SupportPriority,
  SupportSide,
  SupportStatus,
} from './constants'

/** Shapes returned by the support API (shared by the route handlers and the UI). */

export interface PersonRef {
  id: string
  name: string
}

/** Actions the caller may take on a ticket right now (computed by the policy on the server). */
export type TicketAction = 'close' | 'reopen' | 'assign' | 'claim' | 'set_priority' | 'set_category' | 'link'

export interface LinkedTicketRef {
  id: string
  number: string
  subject: string
  status: SupportStatus
}

export interface TicketSummary {
  id: string
  number: string
  legacyNumber: string | null
  subject: string
  category: SupportCategory
  priority: SupportPriority
  status: SupportStatus
  lab: PersonRef
  assignee: PersonRef | null
  createdAt: string
  lastMessageAt: string
  /** Who spoke last in public: drives "Waiting on customer / support". */
  lastPublicSender: SupportSide | null
  /** The caller has public messages they haven't read. */
  unread: boolean
  preview: string | null
  /** Agents only: when support must reply by, and when that becomes urgent (null when not waiting on support). */
  replyDueAt: string | null
  replyWarnAt: string | null
}

export interface TicketDetail extends TicketSummary {
  createdBy: PersonRef | null
  closedAt: string | null
  closeReason: SupportCloseReason | null
  reopenedCount: number
  /** Customers: until when a closed conversation can still be reopened. */
  reopenUntil: string | null
  actions: TicketAction[]
  /** Highest message seq the other side has read (read receipts). */
  otherSideReadSeq: number
  viewerSide: SupportSide
  /** The caller's own id (marks "You" and read receipts without a separate profile request). */
  viewerId: string
  /** The caller's display name (fills {{agent}} in canned replies). */
  viewerName: string
  /** A related conversation of the same lab, if linked. */
  linkedTicket: LinkedTicketRef | null
  /** The lab's rating once given (both sides see it). */
  rating: { score: number; comment: string | null; ratedAt: string } | null
  /** The caller may rate this conversation now. */
  canRate: boolean
  /** Set after the auto-close warning: when the conversation will close unless someone replies. */
  autoCloseAt: string | null
}

export interface CannedReply {
  id: string
  title: string
  body: string
  shortcut: string | null
  /** Shared with every agent (admins manage these). */
  shared: boolean
  /** The caller may edit / delete it. */
  editable: boolean
}

/** Agent-side context about the lab in a conversation. */
export interface CustomerContext {
  lab: {
    id: string
    name: string
    ownerName: string | null
    email: string | null
    phone: string | null
    plan: string | null
    status: string
    memberSince: string
    members: number
  }
  cases: {
    total: number
    open: number
    recent: Array<{ id: string; caseNumber: string; status: string; statusLabel: string; createdAt: string }>
  }
  conversations: {
    total: number
    open: number
    recent: Array<{ id: string; number: string; subject: string; status: SupportStatus; lastMessageAt: string }>
  }
  satisfaction: { average: number | null; ratings: number }
}

export interface AttachmentView {
  id: string
  kind: 'image' | 'video' | 'document'
  fileName: string
  contentType: string
  sizeBytes: number
  /** expired: removed by the 3-month storage retention; the message text stays. */
  status: 'ready' | 'expired'
}

export interface MessageView {
  id: string
  seq: number
  kind: SupportMessageKind
  author: (PersonRef & { side: SupportSide }) | null
  body: string
  attachments: AttachmentView[]
  createdAt: string
  editedAt: string | null
  deleted: boolean
}

/** Returned when an upload starts: the browser PUTs each part straight to storage. */
export interface UploadStart {
  attachmentId: string
  partSize: number
  parts: Array<{ partNumber: number; url: string }>
}

export interface TicketListResponse {
  tickets: TicketSummary[]
  nextCursor: string | null
}

export interface MessagesResponse {
  messages: MessageView[]
  hasMoreBefore: boolean
}

export interface SupportSummary {
  /** Conversations with unread public messages for the caller. */
  unread: number
  /** Agents only: conversations nobody has picked up yet. */
  newCount: number
  /** Agents only: open conversations assigned to the caller. */
  mine: number
  /** Agents only: open conversations past their reply deadline. */
  overdue: number
  /** Is a support agent connected right now? (Labs see "We're online".) */
  agentsOnline: boolean
}

/** Agent dashboard numbers for a period (support-system.md §10). */
export interface SupportMetrics {
  days: number
  created: number
  closed: number
  autoClosed: number
  /** Median minutes from a lab starting a conversation to the first support reply. */
  medianFirstResponseMinutes: number | null
  /** First replies within target, of those due in the period. */
  firstResponseOnTime: number
  firstResponseMeasured: number
  rating: { average: number | null; count: number }
  /** Right now, not for the period. */
  openNow: number
  overdueNow: number
}
