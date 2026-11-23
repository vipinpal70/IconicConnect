import { z } from 'zod'
import {
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  SUPPORT_CATEGORIES,
  SUPPORT_CLOSE_REASONS,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
} from './constants'
import { MAX_ATTACHMENTS_PER_MESSAGE } from './upload-policy'

/** Boundary validation for every support request. Anything not described here is rejected. */

const messageBody = z
  .string()
  .trim()
  .min(1, 'Write a message first')
  .max(MAX_MESSAGE_LENGTH, `Messages can be at most ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`)

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Give the conversation a short subject').max(MAX_SUBJECT_LENGTH),
  category: z.enum(SUPPORT_CATEGORIES),
  message: messageBody,
  /** Agents only; customers always start at "normal" and support triages. */
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  /** Agents only: the lab the conversation is with. */
  clientId: z.uuid().optional(),
  relatedCaseId: z.uuid().optional(),
  source: z.enum(['page', 'widget']).optional(),
  clientMsgId: z.uuid().optional(),
  attachmentIds: z.array(z.uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
})
export type CreateTicketInput = Omit<z.infer<typeof createTicketSchema>, 'attachmentIds'> & { attachmentIds?: string[] }

const attachmentIds = z
  .array(z.uuid())
  .max(MAX_ATTACHMENTS_PER_MESSAGE, `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`)
  .default([])

export const postMessageSchema = z
  .object({
    body: z.string().trim().max(MAX_MESSAGE_LENGTH, `Messages can be at most ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`).default(''),
    visibility: z.enum(['public', 'note']).default('public'),
    clientMsgId: z.uuid(),
    attachmentIds,
  })
  .refine((m) => m.body.length > 0 || m.attachmentIds.length > 0, { message: 'Write a message or attach a file' })
// Callers inside the server may omit attachmentIds (the schema fills in [] for HTTP requests)
export type PostMessageInput = Omit<z.infer<typeof postMessageSchema>, 'attachmentIds'> & { attachmentIds?: string[] }

export const uploadRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('init'),
    fileName: z.string().min(1).max(200),
    fileSize: z.number().int().positive(),
    /** Omit for files attached to a new conversation (customers). */
    ticketId: z.uuid().optional(),
  }),
  z.object({ action: z.literal('sign'), attachmentId: z.uuid() }),
  z.object({
    action: z.literal('complete'),
    attachmentId: z.uuid(),
    parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) })).min(1).max(10_000),
  }),
  z.object({ action: z.literal('abort'), attachmentId: z.uuid() }),
])
export type UploadRequest = z.infer<typeof uploadRequestSchema>

export const markReadSchema = z.object({ seq: z.number().int().nonnegative() })

export const typingSchema = z.object({ visibility: z.enum(['public', 'note']).default('public') })

export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('close'), reason: z.enum(SUPPORT_CLOSE_REASONS).optional() }),
  z.object({ action: z.literal('reopen') }),
  z.object({ action: z.literal('assign'), assigneeId: z.uuid().nullable() }),
  z.object({ action: z.literal('claim') }),
  z.object({ action: z.literal('set_priority'), priority: z.enum(SUPPORT_PRIORITIES) }),
  z.object({ action: z.literal('set_category'), category: z.enum(SUPPORT_CATEGORIES) }),
  /** Link a related conversation of the same lab by its number (e.g. "SUP-000123"), or unlink with null. */
  z.object({ action: z.literal('link'), ticketNumber: z.string().trim().max(30).nullable() }),
])

const shortcut = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Shortcuts use lowercase letters, digits and dashes')

export const cannedReplySchema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(120),
  body: z.string().trim().min(1, 'Write the reply').max(5000),
  shortcut: shortcut.nullable().optional(),
  /** Shared with every agent (admins only). */
  shared: z.boolean().default(false),
})
export type CannedReplyInput = z.infer<typeof cannedReplySchema>
export const cannedReplyUpdateSchema = cannedReplySchema.partial()
export type ActionRequest = z.infer<typeof actionSchema>

export const TICKET_VIEWS = ['open', 'unassigned', 'mine', 'closed', 'all'] as const
export type TicketView = (typeof TICKET_VIEWS)[number]

export const listTicketsQuerySchema = z.object({
  view: z.enum(TICKET_VIEWS).default('open'),
  status: z.enum(SUPPORT_STATUSES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  category: z.enum(SUPPORT_CATEGORIES).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
})
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>

export const listMessagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>
