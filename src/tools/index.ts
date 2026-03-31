// ─── Layer 4: Tools ───────────────────────────────────────────────────────
// Tool definitions and execution - CC-inspired

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { execSync } from 'child_process'

const MAX_OUTPUT = 12000

// ─── Tool Result ───────────────────────────────────────────────────────
export interface ToolResult {
  content: string
  isError: boolean
}

function ok(content: string): ToolResult {
  return { content, isError: false }
}
function err(content: string): ToolResult {
  return { content, isError: true }
}

// ─── Tool Definitions ──────────────────────────────────────────────────
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, any>) => Promise<ToolResult> | ToolResult
}

// ─── Read File ─────────────────────────────────────────────────────────
export const readFileTool: ToolDef = {
  name: 'read_file',
  description: 'Read a file with line numbers. Use offset/limit for large files.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to file' },
      offset: { type: 'integer', description: 'Start line (0-indexed)', default: 0 },
      limit: { type: 'integer', description: 'Max lines', default: 200 },
    },
    required: ['file_path'],
  },
  execute({ file_path, offset = 0, limit = 200 }) {
    try {
      const path = resolve(file_path)
      if (!existsSync(path)) return err(`File not found: ${file_path}`)
      const stat = statSync(path)
      if (stat.size > 2_000_000) return err(`File too large (${stat.size} bytes)`)
      const lines = readFileSync(path, 'utf-8').split('\n')
      const total = lines.length
      const s = offset
      const e = Math.min(offset + limit, total)
      const header = `📄 ${path} (${total} lines)`
      const range = s > 0 ? `\n[showing ${s + 1}-${e}]` : ''
      const body = lines.slice(s, e).map((l, i) => `${(s + i + 1).toString().padStart(6)}→${l}`).join('\n')
      return ok(`${header}${range}\n${body}`)
    } catch (ex: any) {
      return err(`Error: ${ex.message}`)
    }
  },
}

// ─── Write File ────────────────────────────────────────────────────────
export const writeFileTool: ToolDef = {
  name: 'write_file',
  description: 'Create or overwrite a file. For NEW files or complete rewrites.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['file_path', 'content'],
  },
  execute({ file_path, content }) {
    try {
      const path = resolve(file_path)
      const dir = path.substring(0, path.lastIndexOf('/'))
      mkdirSync(dir, { recursive: true })
      const existed = existsSync(path)
      const oldLines = existed ? readFileSync(path, 'utf-8').trim().split('\n').length : 0
      const newLines = content.trim().split('\n').length
      writeFileSync(path, content)
      if (existed) {
        const diff = newLines - oldLines
        return ok(`✏️ Overwrote ${path} (${diff >= 0 ? '+' : ''}${diff} lines, now ${newLines})`)
      }
      return ok(`✅ Created ${path} (${newLines} lines)`)
    } catch (ex: any) {
      return err(`Error: ${ex.message}`)
    }
  },
}

// ─── Edit File ─────────────────────────────────────────────────────────
export const editFileTool: ToolDef = {
  name: 'edit_file',
  description: 'Edit existing file by replacing exact text.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  execute({ file_path, old_string, new_string }) {
    try {
      const path = resolve(file_path)
      if (!existsSync(path)) return err(`File not found: ${file_path}`)
      const content = readFileSync(path, 'utf-8')
      const count = content.split(old_string).length - 1
      if (count === 0) return err('old_string not found. File may have changed. Re-read it.')
      if (count > 1) return err(`old_string found ${count} times. Include more context.`)
      const newContent = content.replace(old_string, new_string)
      writeFileSync(path, newContent)
      const oldN = old_string.split('\n').length
      const newN = new_string.split('\n').length
      return ok(`✏️ Edited ${path.split('/').pop()} (${oldN}→${newN} lines)`)
    } catch (ex: any) {
      return err(`Error: ${ex.message}`)
    }
  },
}

// ─── Bash ──────────────────────────────────────────────────────────────
const BANNED = ['rm -rf /', 'rm -rf /*', 'mkfs', ':(){', 'chmod 777 /', '> /dev/sd', 'dd if=/dev/']

export const bashTool: ToolDef = {
  name: 'bash',
  description: 'Execute a shell command. Dangerous commands are blocked.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout: { type: 'integer', default: 30 },
    },
    required: ['command'],
  },
  execute({ command, timeout = 30 }) {
    for (const banned of BANNED) {
      if (command.includes(banned)) return err(`🚫 Blocked: banned pattern '${banned}'`)
    }
    try {
      const output = execSync(command, {
        timeout: timeout * 1000,
        encoding: 'utf-8',
        maxBuffer: MAX_OUTPUT,
        cwd: process.cwd(),
      })
      const truncated = output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + '\n... (truncated)' : output
      return ok(truncated || '(no output)')
    } catch (ex: any) {
      const out = (ex.stdout || '') + (ex.stderr ? `\n[stderr]\n${ex.stderr}` : '')
      if (ex.status) out + `\n[exit: ${ex.status}]`
      return ok(out || `Error: ${ex.message}`)
    }
  },
}

// ─── Glob ──────────────────────────────────────────────────────────────
export const globTool: ToolDef = {
  name: 'glob',
  description: 'Find files by glob pattern (e.g., **/*.py).',
  parameters: {
    type: 'object',
    properties: { pattern: { type: 'string' } },
    required: ['pattern'],
  },
  execute({ pattern }) {
    try {
      const { globSync } = require('fs') as any
      // Simple glob - use node's built-in
      const matches: string[] = []
      const walk = (dir: string, parts: string[], depth: number) => {
        if (depth > 10 || matches.length > 200) return
        try {
          const entries = readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const full = join(dir, entry.name)
            if (entry.isDirectory() && parts[0] === '**') {
              walk(full, parts, depth + 1)
              walk(full, parts.slice(1), depth + 1)
            } else if (entry.isFile()) {
              const regex = new RegExp('^' + parts.map(p => p.replace(/\*/g, '.*').replace(/\?/g, '.')).join('/') + '$')
              if (regex.test(entry.name) || regex.test(full)) matches.push(full)
            }
          }
        } catch {}
      }
      // Simplified: just use find
      const result = execSync(`find . -name '${pattern}' -not -path './.git/*' 2>/dev/null | head -100`, { encoding: 'utf-8' })
      return ok(result.trim() || `No matches: ${pattern}`)
    } catch (ex: any) {
      return err(`Error: ${ex.message}`)
    }
  },
}

// ─── Grep ──────────────────────────────────────────────────────────────
export const grepTool: ToolDef = {
  name: 'grep',
  description: 'Search file contents with regex.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string', default: '.' },
      include: { type: 'string', default: '' },
    },
    required: ['pattern'],
  },
  execute({ pattern, path = '.', include = '' }) {
    try {
      let cmd = `grep -rn '${pattern}' ${path} --color=never -I`
      if (include) cmd += ` --include='${include}'`
      const result = execSync(cmd + ' 2>/dev/null | head -60', { encoding: 'utf-8', timeout: 15000 })
      return ok(result.trim() || `No matches: ${pattern}`)
    } catch {
      return ok(`No matches: ${pattern}`)
    }
  },
}

// ─── Fetch ─────────────────────────────────────────────────────────────
export const fetchTool: ToolDef = {
  name: 'fetch',
  description: 'Fetch a URL and return its text content.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
  async execute({ url }) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      })
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('text') || ct.includes('json') || ct.includes('html')) {
        let text = await res.text()
        if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n... (truncated)'
        return ok(text)
      }
      return ok(`Binary content: ${ct}, ${Buffer.byteLength(await res.arrayBuffer())} bytes`)
    } catch (ex: any) {
      return err(`Error: ${ex.message}`)
    }
  },
}

// ─── Registry ──────────────────────────────────────────────────────────
export const ALL_TOOLS: ToolDef[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  globTool,
  grepTool,
  fetchTool,
]

export function findTool(name: string): ToolDef | undefined {
  return ALL_TOOLS.find(t => t.name === name)
}

// Convert to OpenAI tool format
export function toOpenAITools() {
  return ALL_TOOLS.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

// Convert to Anthropic tool format
export function toAnthropicTools() {
  return ALL_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object' as const, ...t.parameters },
  }))
}
