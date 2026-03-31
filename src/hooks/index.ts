// ─── Pre/Post Tool Hooks (CC pattern) ───────────────────────────────────────
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { ToolResult } from '../tools/index.js'

export interface PreToolResult {
  allowed: boolean
  reason?: string
}

// CC pattern: validate BEFORE executing
export function preToolValidate(toolName: string, args: Record<string, any>): PreToolResult {
  switch (toolName) {
    case 'edit_file': {
      const p = resolve(args.file_path)
      if (!existsSync(p)) return { allowed: false, reason: `File not found: ${args.file_path}` }
      try {
        const c = readFileSync(p, 'utf-8')
        const n = c.split(args.old_string).length - 1
        if (n === 0) return { allowed: false, reason: 'old_string not found. File may have changed.' }
        if (n > 1) return { allowed: false, reason: `Found ${n} times. Need more context.` }
      } catch { return { allowed: false, reason: 'Cannot read file for validation.' } }
      return { allowed: true }
    }
    case 'read_file': {
      const p = resolve(args.file_path)
      if (!existsSync(p)) return { allowed: false, reason: `File not found: ${args.file_path}` }
      return { allowed: true }
    }
    default: return { allowed: true }
  }
}

// CC pattern: process AFTER executing
export function postToolProcess(toolName: string, result: ToolResult): ToolResult {
  if (result.isError) return result
  if (toolName === 'bash' && (result.content.includes('command not found') || result.content.includes('No such file'))) {
    return { ...result, content: `⚠️ ${result.content}` }
  }
  return result
}
