// ─── Layer 4: Tools ───────────────────────────────────────────────────────
// CC-inspired tool definitions with clear constraints

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { execSync } from 'child_process'

const MAX_OUTPUT = 12000

export interface ToolResult {
  content: string
  isError: boolean
}

function ok(content: string): ToolResult { return { content, isError: false } }
function err(content: string): ToolResult { return { content, isError: true } }

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, any>) => Promise<ToolResult> | ToolResult
}

// ─── Read File ─────────────────────────────────────────────────────────
export const readFileTool: ToolDef = {
  name: 'read_file',
  description: `Read the contents of a file. Returns file content with line numbers.

WHEN TO USE: Reading source code, config files, logs, or any text file.
WHEN NOT TO USE: For writing or modifying files (use write_file or edit_file).
NOTES: Use offset and limit for large files. The output includes line numbers for easy reference.`,
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or relative path to the file to read' },
      offset: { type: 'integer', description: 'Line number to start from (0-indexed)', default: 0 },
      limit: { type: 'integer', description: 'Maximum number of lines to return', default: 200 },
    },
    required: ['file_path'],
  },
  execute({ file_path, offset = 0, limit = 200 }) {
    try {
      const path = resolve(file_path)
      if (!existsSync(path)) return err(`File not found: ${file_path}`)
      const stat = statSync(path)
      if (!stat.isFile()) return err(`Not a file: ${file_path}`)
      if (stat.size > 2_000_000) return err(`File too large (${stat.size.toLocaleString()} bytes). Use offset/limit.`)
      const lines = readFileSync(path, 'utf-8').split('\n')
      const total = lines.length
      const s = Math.max(0, offset)
      const e = Math.min(s + limit, total)
      const header = `\u{1F4C4} ${path} (${total} lines)`
      const range = s > 0 ? `\n[showing ${s + 1}-${e}]` : ''
      const body = lines.slice(s, e).map((l, i) => `${(s + i + 1).toString().padStart(6)}\u2192${l}`).join('\n')
      return ok(`${header}${range}\n${body}`)
    } catch (ex: any) { return err(`Error: ${ex.message}`) }
  },
}

// ─── Write File ────────────────────────────────────────────────────────
export const writeFileTool: ToolDef = {
  name: 'write_file',
  description: `Write content to a file, creating it if needed or overwriting if it exists.

WHEN TO USE: Creating NEW files. Complete rewrites of existing files.
WHEN NOT TO USE: For modifying part of an existing file (use edit_file instead).
NOTES: Creates parent directories automatically. Reports line count changes.`,
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Complete file content' },
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
        return ok(`\u270F\uFE0F Overwrote ${path} (${diff >= 0 ? '+' : ''}${diff} lines, now ${newLines})`)
      }
      return ok(`\u2705 Created ${path} (${newLines} lines)`)
    } catch (ex: any) { return err(`Error: ${ex.message}`) }
  },
}

// ─── Edit File ─────────────────────────────────────────────────────────
export const editFileTool: ToolDef = {
  name: 'edit_file',
  description: `Edit an existing file by replacing one occurrence of old_string with new_string.

WHEN TO USE: Modifying EXISTING files (add, change, or remove specific text).
WHEN NOT TO USE: For creating new files (use write_file) or complete rewrites.
IMPORTANT: old_string must be EXACT text from the file, including whitespace and indentation.
NOTES: If old_string appears more than once, include more surrounding context for uniqueness.`,
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to edit' },
      old_string: { type: 'string', description: 'Exact text to find and replace (must be unique in file)' },
      new_string: { type: 'string', description: 'Replacement text' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  execute({ file_path, old_string, new_string }) {
    try {
      const path = resolve(file_path)
      if (!existsSync(path)) return err(`File not found: ${file_path}`)
      const content = readFileSync(path, 'utf-8')
      const count = content.split(old_string).length - 1
      if (count === 0) return err('old_string not found. The file may have changed. Re-read it first.')
      if (count > 1) return err(`old_string found ${count} times. Include more surrounding context for a unique match.`)
      writeFileSync(path, content.replace(old_string, new_string))
      const oldN = old_string.split('\n').length
      const newN = new_string.split('\n').length
      return ok(`\u270F\uFE0F Edited ${path.split('/').pop()} (${oldN}\u2192${newN} lines)`)
    } catch (ex: any) { return err(`Error: ${ex.message}`) }
  },
}

// ─── Bash ──────────────────────────────────────────────────────────────
const BANNED = ['rm -rf /', 'rm -rf /*', 'mkfs', ':(){', 'chmod 777 /', '> /dev/sd', 'dd if=/dev/']
const SAFE_READONLY = [
  'ls', 'cat', 'head', 'tail', 'pwd', 'date', 'whoami', 'id', 'env',
  'git status', 'git log', 'git diff', 'git show', 'git branch', 'git tag',
  'git remote', 'git ls-files', 'git blame', 'git grep', 'git shortlog',
  'find', 'wc', 'sort', 'uniq', 'which', 'echo', 'test', 'true',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
  'go version', 'rustc --version', 'cargo --version',
]

export const bashTool: ToolDef = {
  name: 'bash',
  description: `Execute a shell command with safety checks.

WHEN TO USE: Running tests, git operations, builds, package management, system info.
WHEN NOT TO USE: For reading files (use read_file), searching (use grep), or finding files (use glob).
SAFETY: Dangerous commands are auto-blocked. Non-readonly commands may require approval.
NOTES: Use timeout for long-running commands. Output is truncated at 12KB.`,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeout: { type: 'integer', description: 'Timeout in seconds', default: 30 },
    },
    required: ['command'],
  },
  execute({ command, timeout = 30 }) {
    for (const banned of BANNED) {
      if (command.includes(banned)) return err(`\u{1F6AB} Blocked: banned pattern '${banned}'`)
    }
    try {
      const output = execSync(command, { timeout: timeout * 1000, encoding: 'utf-8', maxBuffer: MAX_OUTPUT, cwd: process.cwd() })
      return ok(output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + '\n... (truncated)' : (output || '(no output)'))
    } catch (ex: any) {
      const out = (ex.stdout || '') + (ex.stderr ? `\n[stderr]\n${ex.stderr}` : '') + (ex.status ? `\n[exit: ${ex.status}]` : '')
      return ok(out || `Error: ${ex.message}`)
    }
  },
}

// ─── Glob ──────────────────────────────────────────────────────────────
export const globTool: ToolDef = {
  name: 'glob',
  description: `Find files matching a glob pattern.

WHEN TO USE: Finding files by name pattern (e.g., all Python files, all config files).
WHEN NOT TO USE: For searching file contents (use grep) or reading files (use read_file).
NOTES: Supports ** for recursive matching. Use single quotes around patterns.`,
  parameters: {
    type: 'object',
    properties: { pattern: { type: 'string', description: "Glob pattern (e.g., '**/*.py', 'src/**/*.ts')" } },
    required: ['pattern'],
  },
  execute({ pattern }) {
    try {
      const result = execSync(`find . -name '${pattern}' -not -path './.git/*' -not -path './node_modules/*' 2>/dev/null | head -100`, { encoding: 'utf-8', timeout: 10000 })
      return ok(result.trim() || `No matches: ${pattern}`)
    } catch { return ok(`No matches: ${pattern}`) }
  },
}

// ─── Grep ──────────────────────────────────────────────────────────────
export const grepTool: ToolDef = {
  name: 'grep',
  description: `Search file contents with regex pattern.

WHEN TO USE: Finding code by content (function calls, variable names, patterns).
WHEN NOT TO USE: For finding files by name (use glob).
NOTES: Returns file:line format. Use include to filter by file extension.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory or file to search', default: '.' },
      include: { type: 'string', description: "File pattern filter (e.g., '*.py')", default: '' },
    },
    required: ['pattern'],
  },
  execute({ pattern, path = '.', include = '' }) {
    try {
      let cmd = `grep -rn '${pattern}' ${path} --color=never -I 2>/dev/null`
      if (include) cmd = `grep -rn '${pattern}' ${path} --include='${include}' --color=never -I 2>/dev/null`
      const result = execSync(cmd + ' | head -60', { encoding: 'utf-8', timeout: 15000 })
      return ok(result.trim() || `No matches: ${pattern}`)
    } catch { return ok(`No matches: ${pattern}`) }
  },
}

// ─── Fetch ─────────────────────────────────────────────────────────────
export const fetchTool: ToolDef = {
  name: 'fetch',
  description: `Fetch a URL and return its text content.

WHEN TO USE: Reading web pages, API responses, documentation.
WHEN NOT TO USE: For local files (use read_file).
NOTES: Returns text content. Binary files are reported but not returned.`,
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'URL to fetch' } },
    required: ['url'],
  },
  async execute({ url }) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) })
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('text') || ct.includes('json') || ct.includes('html')) {
        let text = await res.text()
        if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n... (truncated)'
        return ok(text)
      }
      return ok(`Binary content: ${ct}`)
    } catch (ex: any) { return err(`Error: ${ex.message}`) }
  },
}

// ─── Registry ──────────────────────────────────────────────────────────
export const ALL_TOOLS: ToolDef[] = [readFileTool, writeFileTool, editFileTool, bashTool, globTool, grepTool, fetchTool]

export function findTool(name: string): ToolDef | undefined {
  return ALL_TOOLS.find(t => t.name === name)
}

export function toOpenAITools() {
  return ALL_TOOLS.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }))
}

export function toAnthropicTools() {
  return ALL_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: { type: 'object' as const, ...t.parameters } }))
}
