// ─── Layer 6: Config ──────────────────────────────────────────────────────
// Configuration, state management, session persistence

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'

export interface CodoConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  provider: 'openai' | 'anthropic' | 'openrouter'
  autoApprove: boolean
  theme: 'dark' | 'light'
}

const CONFIG_DIR = join(homedir(), '.codo')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const HISTORY_DIR = join(CONFIG_DIR, 'history')

const DEFAULT_CONFIG: CodoConfig = {
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'anthropic/claude-sonnet-4',
  maxTokens: 8192,
  provider: 'openrouter',
  autoApprove: false,
  theme: 'dark',
}

export function loadConfig(): CodoConfig {
  mkdirSync(CONFIG_DIR, { recursive: true })
  if (existsSync(CONFIG_FILE)) {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    return { ...DEFAULT_CONFIG, ...raw }
  }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(config: CodoConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

export function getApiKey(config: CodoConfig): string {
  // Priority: config file > env vars
  return (
    config.apiKey ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    ''
  )
}

// Check if API key is available (for display purposes)
export function hasApiKey(config: CodoConfig): boolean {
  return !!(
    config.apiKey ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  )
}

// Session history per project directory
export function getSessionFile(): string {
  mkdirSync(HISTORY_DIR, { recursive: true })
  const hash = createHash('md5').update(process.cwd()).digest('hex').slice(0, 12)
  return join(HISTORY_DIR, `${hash}.json`)
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export function loadSession(): Message[] {
  const file = getSessionFile()
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf-8'))
  }
  return []
}

export function saveSession(messages: Message[]): void {
  const toSave = messages.slice(-40) // Keep last 40 messages
  writeFileSync(getSessionFile(), JSON.stringify(toSave, null, 2))
}
