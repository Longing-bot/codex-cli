// ─── Entry Point ──────────────────────────────────────────────────────────

import React from 'react'
import { render } from 'ink'
import { App } from './ui/App.js'
import { loadConfig, saveConfig, getApiKey, hasApiKey } from './config/index.js'
import { runQuery } from './query/index.js'

const args = process.argv.slice(2)

if (args.includes('--help')) {
  console.log(`
\u{1F99E} codo - AI coding assistant (CC-inspired, model-agnostic)

Usage:
  codo [prompt]           One-shot mode
  codo                    Interactive mode (TUI)
  codo --print [prompt]   Print mode (no TUI, for scripting)
  codo --config           Show configuration
  codo --help             Show this help

Options:
  -m, --model MODEL       Override model for this session
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
  console.log('\u{1F99E} codo configuration\n')
  console.log(`  API Key: ${config.apiKey ? config.apiKey.slice(0, 8) + '...' : '(not set in config)'}`)
  console.log(`  Base URL: ${config.baseUrl}`)
  console.log(`  Model: ${config.model}`)
  console.log(`  Provider: ${detectProvider(config)}`)
  console.log(`  Key available: ${hasApiKey(config) ? '\u2705' : '\u274C NOT SET'}`)
  console.log('\nSet env var or edit ~/.codo/config.json')
  process.exit(0)
}

// Parse args
let initialPrompt: string | undefined
const modelIdx = args.indexOf('-m') !== -1 ? args.indexOf('-m') : args.indexOf('--model')
if (modelIdx !== -1 && args[modelIdx + 1]) {
  const config = loadConfig()
  config.model = args[modelIdx + 1]
  saveConfig(config)
}

const nonFlagArgs = args.filter(a => !a.startsWith('-') && a !== args[modelIdx + 1])
if (nonFlagArgs.length > 0) initialPrompt = nonFlagArgs.join(' ')

const isTTY = process.stdin.isTTY && process.stdout.isTTY

if (isTTY && !args.includes('--print')) {
  render(React.createElement(App, { initialPrompt }))
} else {
  // Print mode
  const config = loadConfig()
  if (!initialPrompt) {
    console.log('\u{1F99E} codo (non-interactive). Use --help for options.')
    process.exit(0)
  }
  console.log(`\u{1F99E} codo [${config.model}]\n`)
  try {
    await runQuery(initialPrompt, config, [], {
      onText: (text) => console.log(`\n${text}`),
      onToolStart: (name, args) => {
        const short = args.length > 50 ? args.slice(0, 50) + '...' : args
        console.log(`\n\u{1F527} ${name}(${short})`)
      },
      onToolResult: (_name, result) => {
        console.log(`   ${result.content.split('\n')[0].slice(0, 80)}`)
      },
      onTurn: (turn) => { if (turn > 1) process.stdout.write(`\r\u23F3 turn ${turn}`) },
      onError: (err) => console.error(`\u274C ${err}`),
    })
  } catch (ex: any) { console.error(`\n\u274C ${ex.message}`); process.exit(1) }
}

function detectProvider(config: any): string {
  if (config.provider) return config.provider
  const url = config.baseUrl || ''
  if (url.includes('anthropic') || url.includes('longcat')) return 'anthropic'
  return 'openrouter'
}
