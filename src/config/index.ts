// ─── Layer 6: Config & Memory ──────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import { execSync } from 'child_process'

export interface CodoConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  provider: 'openai' | 'anthropic' | 'openrouter'
  autoApprove: boolean
  theme: 'dark' | 'light'
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

const CONFIG_DIR = join(homedir(), '.codo')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const HISTORY_DIR = join(CONFIG_DIR, 'history')
const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md', '.codo.md', 'OpenCode.md']

const DEFAULT_CONFIG: CodoConfig = {
  apiKey: '',
  baseUrl: 'https://api.longcat.chat/anthropic',
  model: 'LongCat-Flash-Thinking-2601',
  maxTokens: 8192,
  provider: 'anthropic',
  autoApprove: false,
  theme: 'dark',
}

// ─── Config ────────────────────────────────────────────────────────────
export function loadConfig(): CodoConfig {
  mkdirSync(CONFIG_DIR, { recursive: true })
  if (existsSync(CONFIG_FILE)) {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) } } catch {}
  }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(config: CodoConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

export function getApiKey(config: CodoConfig): string {
  return config.apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || ''
}

export function hasApiKey(config: CodoConfig): boolean {
  return !!(config.apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY)
}

// ─── Environment Info (CC-style) ───────────────────────────────────────
export function getEnvironmentInfo(): string {
  const cwd = process.cwd()
  let gitBranch = '', gitStatus = '', gitLog = ''
  try { gitBranch = execSync('git branch --show-current', { encoding: 'utf-8', timeout: 3000 }).trim() } catch {}
  try { gitStatus = execSync('git status --short', { encoding: 'utf-8', timeout: 3000 }).trim().slice(0, 300) } catch {}
  try { gitLog = execSync('git log --oneline -5', { encoding: 'utf-8', timeout: 3000 }).trim() } catch {}

  let fileTree = ''
  try {
    const entries = readdirSync(cwd).filter(e => !e.startsWith('.git') && e !== 'node_modules').sort().slice(0, 50)
    fileTree = entries.map(e => {
      const isDir = statSync(join(cwd, e)).isDirectory()
      return `${isDir ? '📁' : '📄'} ${e}${isDir ? '/' : ''}`
    }).join('\n')
  } catch { fileTree = '(cannot list)' }

  return `<environment>
Working directory: ${cwd}
Platform: ${process.platform}
Node: ${process.version}
Date: ${new Date().toISOString().split('T')[0]}
Git branch: ${gitBranch || 'not a git repo'}
</environment>

<git_status>
${gitStatus || 'clean or not a git repo'}
</git_status>

<git_log>
${gitLog || 'no commits'}
</git_log>

<project_files>
${fileTree}
</project_files>`
}

// ─── Memory Files ──────────────────────────────────────────────────────
export function loadMemory(): string {
  const cwd = process.cwd()
  const parts: string[] = []
  for (const name of MEMORY_FILES) {
    const p = join(cwd, name)
    if (existsSync(p) && statSync(p).size < 10000) {
      try {
        const content = readFileSync(p, 'utf-8')
        parts.push(`<memory_file path="${name}">\n${content}\n</memory_file>`)
      } catch {}
    }
  }
  return parts.join('\n\n')
}

// ─── Session History ───────────────────────────────────────────────────
export function getSessionFile(): string {
  mkdirSync(HISTORY_DIR, { recursive: true })
  const hash = createHash('md5').update(process.cwd()).digest('hex').slice(0, 12)
  return join(HISTORY_DIR, `${hash}.json`)
}

export function loadSession(): Message[] {
  const file = getSessionFile()
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf-8')) } catch {} }
  return []
}

export function saveSession(messages: Message[]): void {
  writeFileSync(getSessionFile(), JSON.stringify(messages.slice(-40), null, 2))
}
