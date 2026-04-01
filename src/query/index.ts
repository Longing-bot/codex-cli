// ─── Query Engine（CC 流式循环）────────────────────────────────────────────
import { CodoConfig, Message, detectProvider, saveSession, getUsageTracker, type TokenUsage } from '../config/index.js'
import { callLLM } from '../api/index.js'
import { findTool, toOpenAI, toAnthropic, getActiveTools, activateLazyTool, CORE_TOOLS, LAZY_TOOLS, type ToolResult } from '../tools/index.js'
import { buildSystemPrompt } from '../prompts/system.js'
import { executePreToolHooks, executePostToolHooks } from '../hooks/index.js'
import { createBudgetTracker, checkBudget } from '../memory/index.js'
import { shouldFlushMemory, buildFlushMessages } from '../memory/flush.js'
import { shouldCompact, buildCompactedMessages, autoCompactMessages, COMPACT_PROMPT } from '../memory/compact.js'
import { checkPermission } from '../permissions/index.js'

const MAX_TURNS = 80
const COMPACTION_THRESHOLD = 200_000 // 200K input tokens

export interface QueryCallbacks {
  onText?: (text: string) => void
  onToken?: (token: string) => void   // 流式逐字回调
  onToolStart?: (name: string, args: string) => void
  onToolResult?: (name: string, result: ToolResult) => void
  onTurn?: (turn: number) => void
  onUsage?: (usage: TokenUsage, model: string) => void
  onError?: (error: string) => void
}

export async function runQuery(
  userMessage: string,
  config: CodoConfig,
  messages: Message[],
  callbacks: QueryCallbacks = {},
): Promise<Message[]> {
  const { onText, onToken, onToolStart, onToolResult, onTurn, onUsage, onError } = callbacks

  if (!messages.length || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: buildSystemPrompt() })
  }

  messages.push({ role: 'user', content: userMessage })

  const tracker = getUsageTracker()
  // 默认只发核心工具定义，其他通过 tool_search 按需激活
  let tools = detectProvider(config) === 'anthropic'
    ? toAnthropic(CORE_TOOLS)
    : toOpenAI(CORE_TOOLS)

  const budget = createBudgetTracker()

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    onTurn?.(turn)

    // CC 风格：检查 token 预算
    const decision = checkBudget(budget, messages)
    if (decision.action === 'stop') {
      onError?.('上下文已满。请使用 /clear 清除历史或 /compact 压缩。')
      break
    }

    // OpenClaw 风格：压缩前自动记忆刷新
    if (shouldFlushMemory(messages)) {
      const flushMsgs = buildFlushMessages()
      // 将刷新消息注入到当前对话（模型会自动保存记忆）
      for (const m of flushMsgs) {
        if (!messages.some(existing => existing.content === m.content)) {
          messages.push(m)
        }
      }
    }

    // 如果需要 continue 提示，加入系统消息
    if (decision.nudgeMessage && !messages.some(m => m.content === decision.nudgeMessage)) {
      messages.push({ role: 'user', content: decision.nudgeMessage })
    }

    // 自动压缩检查（200K 阈值）
    if (shouldCompact(messages, COMPACTION_THRESHOLD)) {
      // 自动压缩：保留系统提示 + 最近 4 条 + 生成摘要
      const compacted = autoCompactMessages(messages)
      messages.length = 0
      messages.push(...compacted)
      onText?.('\n📝 上下文已自动压缩，继续工作...\n')
    }

    let response
    try {
      // 流式调用：有 onToken 就走流式
      response = await callLLM(messages, tools as any, config, onToken ? { onToken } : undefined)
    } catch (ex: any) {
      onError?.(ex.message)
      break
    }

    // 记录 token 用量
    if (response.usage) {
      tracker.recordTurn(response.usage)
      onUsage?.(response.usage, config.model)
    }

    // 流式已经逐字输出，这里只在非流式时回调 onText
    if (!onToken && response.content) onText?.(response.content)

    // 没有 tool_calls → 结束
    if (!response.toolCalls?.length) {
      messages.push({ role: 'assistant', content: response.content })
      break
    }

    // 有 tool_calls → 执行工具
    messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls })

    for (const tc of response.toolCalls) {
      // 检查是否为延迟工具，需要激活
      const lazyTool = LAZY_TOOLS.find(t => t.name === tc.function.name)
      if (lazyTool && !getActiveTools().find(t => t.name === tc.function.name)) {
        activateLazyTool(tc.function.name)
        // 重新生成工具列表
        const activeTools = [...getActiveTools()]
        tools = detectProvider(config) === 'anthropic'
          ? toAnthropic(activeTools)
          : toOpenAI(activeTools)
      }

      onToolStart?.(tc.function.name, tc.function.arguments)

      const tool = findTool(tc.function.name)
      let result: ToolResult

      if (!tool) {
        result = { content: `未知工具: ${tc.function.name}`, isError: true }
      } else {
        // 权限检查
        const perm = checkPermission(tc.function.name)
        if (!perm.allowed) {
          result = { content: perm.reason!, isError: true }
          onToolResult?.(tc.function.name, result)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result.content })
          continue
        }

        const args = JSON.parse(tc.function.arguments)
        const preCheck = await executePreToolHooks(tc.function.name, args)
        if (!preCheck.allowed) {
          result = { content: preCheck.reason!, isError: true }
        } else {
          try { result = await tool.execute(args) }
          catch (ex: any) { result = { content: ex.message, isError: true } }
          result = await executePostToolHooks(tc.function.name, args, result)
        }
      }

      onToolResult?.(tc.function.name, result)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result.content })
    }
  }

  saveSession(messages)
  return messages
}
