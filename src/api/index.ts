// ─── Layer 5: API (with CC-style retry) ─────────────────────────────────────
// CC patterns:
// - Exponential backoff on 429/500/503
// - Max 3 retries for rate limits
// - Fallback model support
// - Error classification (retryable vs fatal)

import { CodoConfig, Message, ToolCall, getApiKey, detectProvider } from '../config/index.js'
export interface LLMResponse { content: string; toolCalls: ToolCall[] }

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options)
      if (res.ok) return res

      if (isRetryable(res.status) && attempt < retries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500
        const body = await res.text().catch(() => '')
        const retryAfter = res.headers.get('retry-after')
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : delay
        process.stderr.write(`\n⏳ API ${res.status}, retrying in ${Math.round(waitMs/1000)}s (${attempt + 1}/${retries})\n`)
        await sleep(waitMs)
        continue
      }

      const body = await res.text()
      throw new Error(`API ${res.status}: ${body.slice(0, 300)}`)
    } catch (ex: any) {
      if (attempt < retries && (ex.message?.includes('fetch failed') || ex.message?.includes('ECONNRESET'))) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt)
        process.stderr.write(`\n⏳ Connection error, retrying in ${delay/1000}s (${attempt + 1}/${retries})\n`)
        await sleep(delay)
        continue
      }
      throw ex
    }
  }
  throw new Error('Max retries exceeded')
}

async function callOpenAI(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  const key = getApiKey(config); if (!key) throw new Error('No API key')
  const base = config.baseUrl.replace(/\/$/, '')
  const res = await fetchWithRetry(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(base.includes('openrouter') ? { 'HTTP-Referer': 'https://github.com/longing-bot/codo', 'X-Title': 'codo' } : {}) },
    body: JSON.stringify({ model: config.model, messages, tools, max_tokens: config.maxTokens }),
  })
  const d = await res.json() as any; const m = d.choices?.[0]?.message ?? {}
  return { content: m.content ?? '', toolCalls: m.tool_calls ?? [] }
}

async function callAnthropic(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  const key = getApiKey(config); if (!key) throw new Error('No API key')
  const base = config.baseUrl.replace(/\/$/, '')
  const isLC = base.includes('longcat')
  let sys = ''; const chat: any[] = []
  for (const m of messages) {
    if (m.role === 'system') sys = m.content
    else if (m.role === 'tool') chat.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] })
    else if (m.role === 'assistant' && m.tool_calls?.length) {
      const c: any[] = []; if (m.content) c.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) c.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) })
      chat.push({ role: 'assistant', content: c })
    } else chat.push(m)
  }
  const auth = isLC ? { Authorization: `Bearer ${key}` } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  const res = await fetchWithRetry(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ model: config.model, max_tokens: config.maxTokens, system: sys, messages: chat, tools }),
  })
  const d = await res.json() as any; let content = ''; const tc: ToolCall[] = []
  for (const b of d.content ?? []) { if (b.type === 'text') content += b.text; if (b.type === 'tool_use') tc.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }) }
  return { content, toolCalls: tc }
}

export async function callLLM(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  return detectProvider(config) === 'anthropic' ? callAnthropic(messages, tools, config) : callOpenAI(messages, tools, config)
}
