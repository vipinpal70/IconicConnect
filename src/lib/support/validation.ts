import { z } from 'zod'
import {
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  SUPPORT_CATEGORIES,
  SUPPORT_CLOSE_REASONS,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
} from './constants'

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
})
export type CreateTicketInput = z.infer<typeof createTicketSchema>

export const postMessageSchema = z.object({
  body: messageBody,
  visibility: z.enum(['public', 'note']).default('public'),
  clientMsgId: z.uuid(),
})
export type PostMessageInput = z.infer<typeof postMessageSchema>

export const markReadSchema = z.object({ seq: z.number().int().nonnegative() })

export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('close'), reason: z.enum(SUPPORT_CLOSE_REASONS).optional() }),
  z.object({ action: z.literal('reopen') }),
  z.object({ action: z.literal('assign'), assigneeId: z.uuid().nullable() }),
  z.object({ action: z.literal('claim') }),
  z.object({ action: z.literal('set_priority'), priority: z.enum(SUPPORT_PRIORITIES) }),
  z.object({ action: z.literal('set_category'), category: z.enum(SUPPORT_CATEGORIES) }),
])
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
