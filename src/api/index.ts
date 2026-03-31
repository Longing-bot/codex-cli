// ─── Layer 5: API ─────────────────────────────────────────────────────────
// Multi-provider LLM API with auto-detection

import { CodoConfig, Message, ToolCall, getApiKey } from '../config/index.js'

export interface LLMResponse {
  content: string
  toolCalls: ToolCall[]
}

export function detectProvider(config: CodoConfig): string {
  if (config.provider) return config.provider
  const url = config.baseUrl
  if (url.includes('anthropic') || url.includes('longcat')) return 'anthropic'
  if (url.includes('openai') && !url.includes('openrouter')) return 'openai'
  return 'openrouter'
}

// ─── OpenAI-compatible ────────────────────────────────────────────────
async function callOpenAI(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  const apiKey = getApiKey(config)
  if (!apiKey) throw new Error('No API key. Set OPENROUTER_API_KEY or run: codo --config')
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(baseUrl.includes('openrouter') ? { 'HTTP-Referer': 'https://github.com/longing-bot/codo', 'X-Title': 'codo' } : {}) },
    body: JSON.stringify({ model: config.model, messages, tools, max_tokens: config.maxTokens, stream: false }),
  })
  if (!res.ok) { const e = await res.text(); throw new Error(`API ${res.status}: ${e.slice(0, 300)}`) }
  const data = await res.json() as any
  const msg = data.choices?.[0]?.message ?? {}
  return { content: msg.content ?? '', toolCalls: msg.tool_calls ?? [] }
}

// ─── Anthropic-compatible ─────────────────────────────────────────────
async function callAnthropic(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  const apiKey = getApiKey(config)
  if (!apiKey) throw new Error('No API key.')
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const isLongCat = baseUrl.includes('longcat')

  let systemMsg = ''
  const chatMessages: any[] = []
  for (const m of messages) {
    if (m.role === 'system') { systemMsg = m.content }
    else if (m.role === 'tool') { chatMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] }) }
    else if (m.role === 'assistant' && m.tool_calls?.length) {
      const content: any[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) })
      chatMessages.push({ role: 'assistant', content })
    } else { chatMessages.push(m) }
  }

  const authHeaders = isLongCat ? { 'Authorization': `Bearer ${apiKey}` } : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ model: config.model, max_tokens: config.maxTokens, system: systemMsg, messages: chatMessages, tools }),
  })
  if (!res.ok) { const e = await res.text(); throw new Error(`API ${res.status}: ${e.slice(0, 300)}`) }
  const data = await res.json() as any
  let content = ''
  const toolCalls: ToolCall[] = []
  for (const block of data.content ?? []) {
    if (block.type === 'text') content += block.text
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } })
  }
  return { content, toolCalls }
}

export async function callLLM(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  const provider = detectProvider(config)
  if (provider === 'anthropic') return callAnthropic(messages, tools, config)
  return callOpenAI(messages, tools, config)
}
