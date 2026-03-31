// ─── Layer 3: Query ────────────────────────────────────────────────────────
// LLM call + tool execution loop (CC-inspired architecture)
//
// Flow: while(true) { call_llm → if tool_calls: execute → loop; else: break }

import { CodoConfig, Message, ToolCall, saveSession } from '../config/index.js'
import { callLLM, LLMResponse, detectProvider } from '../api/index.js'
import { findTool, toOpenAITools, toAnthropicTools, ToolResult } from '../tools/index.js'

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

  messages.push({ role: 'user', content: userMessage })

  const tools = detectProvider(config) === 'anthropic' ? toAnthropicTools() : toOpenAITools()

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    onTurn?.(turn)

    let response: LLMResponse
    try {
      response = await callLLM(messages, tools as any, config)
    } catch (ex: any) {
      onError?.(ex.message)
      break
    }

    // Show assistant text
    if (response.content) {
      onText?.(response.content)
    }

    // No tool calls → done
    if (!response.toolCalls?.length) {
      messages.push({ role: 'assistant', content: response.content })
      break
    }

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.toolCalls,
    })

    // Execute each tool call
    for (const tc of response.toolCalls) {
      const argsStr = tc.function.arguments
      onToolStart?.(tc.function.name, argsStr)

      const tool = findTool(tc.function.name)
      let result: ToolResult

      if (!tool) {
        result = { content: `Error: Unknown tool: ${tc.function.name}`, isError: true }
      } else {
        try {
          const args = JSON.parse(argsStr)
          result = await tool.execute(args)
        } catch (ex: any) {
          result = { content: `Error: ${ex.message}`, isError: true }
        }
      }

      onToolResult?.(tc.function.name, result)

      // Add tool result to messages
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result.content,
      })
    }
  }

  saveSession(messages)
  return messages
}
