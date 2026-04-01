// ─── 记忆文件系统（CC CLAUDE.md + MEMORY.md 风格）──────────────────────────
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { homedir } from 'os'

// CC 加载顺序（优先级从低到高）
const MEMORY_FILES = [
  // 用户级
  { path: join(homedir(), '.edgecli', 'CLAUDE.md'), name: '用户级' },
  { path: join(homedir(), '.edgecli', 'MEMORY.md'), name: '用户记忆' },
  // 项目级（向上查找）
]

const MAX_MEMORY_LINES = 200
const MAX_MEMORY_BYTES = 25_000

// 截断 MEMORY.md（CC 风格）
function truncateMemory(content: string): string {
  const lines = content.trim().split('\n')
  let result = content

  // 行数限制
  if (lines.length > MAX_MEMORY_LINES) {
    result = lines.slice(0, MAX_MEMORY_LINES).join('\n') +
      `\n\n[⚠️ 已截断：超过 ${MAX_MEMORY_LINES} 行限制]`
  }

  // 字节限制
  if (Buffer.byteLength(result, 'utf-8') > MAX_MEMORY_BYTES) {
    const truncated = result.slice(0, MAX_MEMORY_BYTES)
    const lastNewline = truncated.lastIndexOf('\n')
    result = truncated.slice(0, lastNewline) +
      `\n\n[⚠️ 已截断：超过 ${MAX_MEMORY_BYTES} 字节限制]`
  }

  return result
}

// 查找项目级 CLAUDE.md（从当前目录向上）
function findProjectMemory(cwd: string): string | null {
  let dir = cwd
  while (true) {
    const projectPath = join(dir, 'CLAUDE.md')
    if (existsSync(projectPath)) return projectPath

    const localPath = join(dir, 'CLAUDE.local.md')
    if (existsSync(localPath)) return localPath

    const edgecliPath = join(dir, '.edgecli', 'CLAUDE.md')
    if (existsSync(edgecliPath)) return edgecliPath

    const parent = dirname(dir)
    if (parent === dir) break // 到根目录了
    dir = parent
  }
  return null
}

// 处理 @include 指令（CC @path 语法）
function expandIncludes(content: string, basePath: string, seen = new Set<string>()): string {
  return content.replace(/@(\S+)/g, (_, includePath: string) => {
    let resolved: string
    if (includePath.startsWith('~/')) {
      resolved = join(homedir(), includePath.slice(2))
    } else if (includePath.startsWith('/')) {
      resolved = includePath
    } else {
      resolved = join(dirname(basePath), includePath)
    }

    if (seen.has(resolved)) return `[循环引用: ${includePath}]`
    if (!existsSync(resolved)) return ''

    seen.add(resolved)
    const included = readFileSync(resolved, 'utf-8')
    return expandIncludes(included, resolved, seen)
  })
}

// 加载所有记忆文件（CC loadMemoryPrompt 风格）
export function loadMemoryFiles(cwd: string = process.cwd()): string {
  const parts: string[] = []

  // 1. 用户级
  for (const file of MEMORY_FILES) {
    if (existsSync(file.path)) {
      try {
        let content = readFileSync(file.path, 'utf-8')
        content = expandIncludes(content, file.path)
        parts.push(`# ${file.name}: ${file.path}\n${content}`)
      } catch {}
    }
  }

  // 2. 项目级
  const projectPath = findProjectMemory(cwd)
  if (projectPath) {
    try {
      let content = readFileSync(projectPath, 'utf-8')
      content = expandIncludes(content, projectPath)
      parts.push(`# 项目级: ${projectPath}\n${truncateMemory(content)}`)
    } catch {}
  }

  return parts.join('\n\n---\n\n')
}

// 保存记忆到 MEMORY.md
export function saveMemory(content: string, cwd: string = process.cwd()): void {
  const memoryDir = join(homedir(), '.edgecli')
  mkdirSync(memoryDir, { recursive: true })

  const memoryFile = join(memoryDir, 'MEMORY.md')
  let existing = ''
  if (existsSync(memoryFile)) {
    existing = readFileSync(memoryFile, 'utf-8')
  }

  const timestamp = new Date().toISOString().slice(0, 16)
  const entry = `\n## ${timestamp}\n${content}\n`

  const newContent = existing + entry
  writeFileSync(memoryFile, truncateMemory(newContent))
}
