// ─── Slash Commands (CC pattern) ───────────────────────────────────────────
import { existsSync, unlinkSync } from 'fs'
import { getSessionFile, loadSession } from '../config/index.js'

export interface CommandResult {
  type: 'info' | 'action' | 'error'
  content: string
  clearHistory?: boolean
}

const COMMANDS = [
  { name: 'help', aliases: ['h', '?'], desc: 'Show available commands',
    exec: () => ({ type: 'info', content: `🦞 codo commands:\n  /help (?/)      Show this help\n  /clear          Clear conversation\n  /history        Show message count\n  /compact       Compact conversation
  /quit (q/)      Exit` }) },
  { name: 'clear', desc: 'Clear conversation history',
    exec: () => { const f = getSessionFile(); if (existsSync(f)) unlinkSync(f); return { type: 'action', content: '🗑️ Cleared.', clearHistory: true } } },
  { name: 'history', desc: 'Show history stats',
    exec: () => { const m = loadSession(); return { type: 'info', content: `📜 ${m.length} messages (${m.filter(x => x.role === 'user').length} user, ${m.filter(x => x.role === 'tool').length} tool)` } } },
  { name: 'compact', desc: 'Summarize conversation to save context',
    exec: () => ({ type: 'action', content: '📝 Use --print "/compact" to trigger compaction, or let codo auto-compact when context is large.' }) },
  { name: 'quit', aliases: ['q', 'exit'], desc: 'Exit',
    exec: () => { process.exit(0); return { type: 'info', content: '' } } },
] as const

export function processCommand(input: string): CommandResult | null {
  if (!input.startsWith('/')) return null
  const sp = input.indexOf(' ')
  const name = sp === -1 ? input.slice(1) : input.slice(1, sp)
  const cmd = COMMANDS.find(c => c.name === name || c.aliases?.includes(name))
  if (!cmd) return { type: 'error', content: `Unknown: /${name}. Try /help` }
  return cmd.exec()
}
