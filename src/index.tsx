// ─── Entry Point ──────────────────────────────────────────────────────────

import React from 'react'
import { render } from 'ink'
import { App } from './ui/App.js'
import { loadConfig, saveConfig, getApiKey, hasApiKey } from './config/index.js'
import { runQuery } from './query/index.js'

const args = process.argv.slice(2)

// Handle CLI flags
if (args.includes('--help')) {
  console.log(`
🦞 codo - AI coding assistant

Usage:
  codo [prompt]           One-shot mode
  codo                    Interactive mode (TUI)
  codo --print [prompt]   Print mode (no TUI, for scripting)
  codo --config           Show configuration
  codo --help             Show this help

Options:
  -m, --model MODEL       Override model
  --provider PROVIDER     Force provider (openai|anthropic|openrouter)

Environment:
  OPENROUTER_API_KEY      API key for OpenRouter
  OPENAI_API_KEY          API key for OpenAI
  ANTHROPIC_API_KEY       API key for Anthropic
`)
  process.exit(0)
}

if (args.includes('--config')) {
  const config = loadConfig()
  console.log('🦞 codo configuration\n')
  console.log(`  API Key: ${config.apiKey ? config.apiKey.slice(0, 8) + '...' : '(not set in config)'}`)
  console.log(`  Base URL: ${config.baseUrl}`)
  console.log(`  Model: ${config.model}`)
  console.log(`  Provider: ${config.provider}`)
  console.log(`  Key available: ${hasApiKey(config) ? '✓' : '✗ NOT SET'}`)
  console.log('\nSet OPENROUTER_API_KEY env var or edit ~/.codo/config.json')
  process.exit(0)
}

// Parse remaining args
let initialPrompt: string | undefined
const modelIdx = args.indexOf('-m') !== -1 ? args.indexOf('-m') : args.indexOf('--model')
if (modelIdx !== -1 && args[modelIdx + 1]) {
  const config = loadConfig()
  config.model = args[modelIdx + 1]
  saveConfig(config)
}

const nonFlagArgs = args.filter(a => !a.startsWith('-') && a !== args[modelIdx + 1])
if (nonFlagArgs.length > 0) {
  initialPrompt = nonFlagArgs.join(' ')
}

// Check if we're in a TTY
const isTTY = process.stdin.isTTY && process.stdout.isTTY

if (isTTY && !args.includes('--print')) {
  // Interactive TUI mode
  render(React.createElement(App, { initialPrompt }))
} else {
  // Print mode (no TUI) - for scripting and non-TTY environments
  const config = loadConfig()
  if (!initialPrompt) {
    console.log('🦞 codo (non-interactive mode). Use --help for options.')
    process.exit(0)
  }

  console.log(`🦞 codo [${config.model}]\n`)

  const callbacks = {
    onText: (text: string) => console.log(`\n${text}`),
    onToolStart: (name: string, args: string) => {
      const short = args.length > 60 ? args.slice(0, 60) + '...' : args
      console.log(`\n🔧 ${name}(${short})`)
    },
    onToolResult: (_name: string, result: any) => {
      const firstLine = result.content.split('\n')[0].slice(0, 100)
      console.log(`   → ${firstLine}`)
    },
    onTurn: (turn: number) => {
      if (turn > 1) process.stdout.write(`\r⏳ turn ${turn}`)
    },
    onError: (err: string) => console.error(`❌ ${err}`),
  }

  try {
    await runQuery(initialPrompt, config, [], callbacks)
    console.log('\n')
  } catch (ex: any) {
    console.error(`\n❌ ${ex.message}`)
    process.exit(1)
  }
}