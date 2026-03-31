// ─── Layer 1: UI ───────────────────────────────────────────────────────────
// React + Ink terminal UI

import React, { useState, useCallback } from 'react'
import { Box, Text, useApp, useStdin } from 'ink'
import TextInput from 'ink-text-input'
import { loadConfig, type CodoConfig, type Message } from '../config/index.js'
import { runQuery, type QueryCallbacks } from '../query/index.js'
import { createREPLState } from '../repl/index.js'
import type { ToolResult } from '../tools/index.js'

interface Props {
  initialPrompt?: string
}

interface ChatEntry {
  type: 'user' | 'assistant' | 'tool' | 'error' | 'system'
  content: string
  toolName?: string
}

export const App: React.FC<Props> = ({ initialPrompt }) => {
  const { exit } = useApp()
  const config = loadConfig()

  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [turn, setTurn] = useState(0)

  const replState = createREPLState()
  const [messages, setMessages] = useState<Message[]>(replState.messages)

  const addEntry = useCallback((entry: ChatEntry) => {
    setEntries(prev => [...prev, entry])
  }, [])

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim()) return

    addEntry({ type: 'user', content: text })
    setInput('')
    setIsRunning(true)
    setTurn(0)

    const callbacks: QueryCallbacks = {
      onText: (t) => addEntry({ type: 'assistant', content: t }),
      onToolStart: (name, args) => {
        const short = args.length > 60 ? args.slice(0, 60) + '...' : args
        addEntry({ type: 'tool', content: `${name}(${short})`, toolName: name })
      },
      onToolResult: (name, result) => {
        const firstLine = result.content.split('\n')[0].slice(0, 100)
        addEntry({ type: 'system', content: `  → ${firstLine}` })
      },
      onTurn: (t) => setTurn(t),
      onError: (err) => addEntry({ type: 'error', content: err }),
    }

    try {
      const updated = await runQuery(text, config, [...messages], callbacks)
      setMessages(updated)
    } catch (ex: any) {
      addEntry({ type: 'error', content: ex.message })
    }

    setIsRunning(false)
  }, [config, messages, addEntry])

  // Auto-submit initial prompt
  React.useEffect(() => {
    if (initialPrompt) handleSubmit(initialPrompt)
  }, [])

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">🦞 codo </Text>
        <Text dimColor>[{config.model}]</Text>
      </Box>

      {/* Chat entries */}
      {entries.map((entry, i) => (
        <Box key={i} marginBottom={1}>
          {entry.type === 'user' && (
            <Box>
              <Text color="green" bold>{'> '}</Text>
              <Text>{entry.content}</Text>
            </Box>
          )}
          {entry.type === 'assistant' && (
            <Box marginLeft={2}>
              <Text>{entry.content}</Text>
            </Box>
          )}
          {entry.type === 'tool' && (
            <Box marginLeft={2}>
              <Text color="yellow">🔧 </Text>
              <Text color="yellow">{entry.content}</Text>
            </Box>
          )}
          {entry.type === 'system' && (
            <Box marginLeft={4}>
              <Text dimColor>{entry.content}</Text>
            </Box>
          )}
          {entry.type === 'error' && (
            <Box marginLeft={2}>
              <Text color="red">❌ {entry.content}</Text>
            </Box>
          )}
        </Box>
      ))}

      {/* Turn indicator */}
      {isRunning && turn > 1 && (
        <Box marginLeft={2}>
          <Text dimColor>⏳ turn {turn}</Text>
        </Box>
      )}

      {/* Input */}
      {!isRunning && (
        <Box>
          <Text color="green" bold>{'> '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Type your request..."
          />
        </Box>
      )}
    </Box>
  )
}
