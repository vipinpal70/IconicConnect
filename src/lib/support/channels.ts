/** Support's live channels. No imports: used by the stream, the publisher and tests. */

const CHANNEL_PREFIX = 'sup:'
/** Everything agents may know about, including internal notes. */
export const agentsChannel = `${CHANNEL_PREFIX}agents`
/** What one lab's people may know about. */
export const labChannel = (clientId: string) => `${CHANNEL_PREFIX}lab:${clientId}`

/** Counts the changes published on a channel (not typing). */
export const supportVersionKey = (channel: string) => `ver:live:${channel}`
