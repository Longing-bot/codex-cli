// ─── Layer 3: Query ────────────────────────────────────────────────────────
// CC-style tool-gated execution loop
// while(true) { call_llm -> if tool_calls: execute -> loop; else: break }

import { CodoConfig, Message, ToolCall, saveSession } from '../config/index.js'
import { callLLM, detectProvider } from '../api/index.js'
import { findTool, toOpenAITools, toAnthropicTools, ToolResult } from '../tools/index.js'
import { buildSystemPrompt } from '../prompts/system.js'

const MAX_TURNS = 80

export interface QueryCallbacks {
  onText?: (text: string) => void
  onToolStart?: (name: string, args: string) => void
  onToolResult?: (name: string, result: ToolResult) => void
  onTurn?: (turn: number) => void
  onError?: (error: string) => void
}

export async function runQuery(
  userMessage: string,
  config: CodoConfig,
  messages: Message[],
  callbacks: QueryCallbacks = {},
): Promise<Message[]> {
  const { onText, onToolStart, onToolResult, onTurn, onError } = callbacks

  // If first message, add system prompt
  if (!messages.length || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: buildSystemPrompt() })
  }

  messages.push({ role: 'user', content: userMessage })

  const tools = detectProvider(config) === 'anthropic' ? toAnthropicTools() : toOpenAITools()

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    onTurn?.(turn)

    let response
    try {
      response = await callLLM(messages, tools as any, config)
    } catch (ex: any) {
      onError?.(ex.message)
      break
    }

    if (response.content) onText?.(response.content)

    if (!response.toolCalls?.length) {
      messages.push({ role: 'assistant', content: response.content })
      break
    }

    messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls })

    for (const tc of response.toolCalls) {
      const argsStr = tc.function.arguments
      onToolStart?.(tc.function.name, argsStr)

      const tool = findTool(tc.function.name)
      let result: ToolResult

      if (!tool) {
        result = { content: `Error: Unknown tool: ${tc.function.name}`, isError: true }
      } else {
        try { result = await tool.execute(JSON.parse(argsStr)) }
        catch (ex: any) { result = { content: `Error: ${ex.message}`, isError: true } }
      }

      onToolResult?.(tc.function.name, result)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result.content })
    }
  }

  saveSession(messages)
  return messages
}
