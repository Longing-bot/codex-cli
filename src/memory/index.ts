// ─── Memory & Context Management (CC pattern) ──────────────────────────────
export { COMPACT_PROMPT, buildCompactedMessages, shouldCompact, getCompactionRequest } from './compact.js'

import { type Message } from '../config/index.js'

// Rough token estimation
export function estimateTokens(text: string): number {
  const ascii = text.replace(/[\u4e00-\u9fff]/g, '').length
  const cjk = text.length - ascii
  return Math.ceil(ascii / 4 + cjk / 1.5)
}

export function estimateMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => {
    let tokens = estimateTokens(m.content)
    if (m.tool_calls) tokens += m.tool_calls.length * 50
    return sum + tokens
  }, 0)
}

export function getContextStats(messages: Message[]): string {
  const total = estimateMessageTokens(messages)
  const userMsgs = messages.filter(m => m.role === 'user').length
  const toolCalls = messages.filter(m => m.role === 'tool').length
  return `~${total.toLocaleString()} tok (${userMsgs}u ${toolCalls}t)`
}
