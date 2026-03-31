// ─── Memory & Context Management (CC pattern) ──────────────────────────────
// CC tracks token usage, context size, and auto-compacts when needed.

import { type Message } from '../config/index.js'

// Rough token estimation (CC uses tiktoken, we approximate)
export function estimateTokens(text: string): number {
  // ~4 chars per token for English, ~2 for CJK
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

// CC pattern: context stats for the user
export function getContextStats(messages: Message[]): string {
  const total = estimateMessageTokens(messages)
  const userMsgs = messages.filter(m => m.role === 'user').length
  const toolCalls = messages.filter(m => m.role === 'tool').length
  const assistantMsgs = messages.filter(m => m.role === 'assistant').length
  return `Context: ~${total.toLocaleString()} tokens (${userMsgs} user, ${assistantMsgs} assistant, ${toolCalls} tool results)`
}

// CC pattern: compaction prompt
export const COMPACT_PROMPT = `Summarize the conversation so far into a concise summary that preserves:
1. All decisions made and their rationale
2. Current state of any ongoing work
3. Key file paths and code changes
4. Important context for continuing the conversation

Be concise. Use bullet points. Do not include conversational filler.`

// CC pattern: check if we should compact
export function shouldCompact(messages: Message[], maxTokens: number = 80000): boolean {
  return estimateMessageTokens(messages) > maxTokens
}
