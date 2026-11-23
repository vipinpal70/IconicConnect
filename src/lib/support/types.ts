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
export type TicketAction = 'close' | 'reopen' | 'assign' | 'claim' | 'set_priority' | 'set_category'

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
  /** Is a support agent connected right now? (Labs see "We're online".) */
  agentsOnline: boolean
}
