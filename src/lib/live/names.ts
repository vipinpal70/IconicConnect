/** Channel and counter names of the live connection. No imports. */

export const userChannel = (userId: string) => `live:user:${userId}`
export const labChannel = (clientId: string) => `live:lab:${clientId}`
export const staffChannel = 'live:staff'
export const allLabsChannel = 'live:labs'

/** Counts the events of a channel, so that a browser can tell it missed one. */
export const versionKey = (channel: string) => `ver:live:${channel}`
