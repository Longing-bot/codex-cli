// ─── AutoDream 后台记忆整理（CC autoDream 风格）─────────────────────────────
// CC 的 autoDream 三道门：时间门 + 会话门 + 锁门
// 失败回滚 lock，下次重试

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface DreamState {
  lastConsolidatedAt: number
  sessionCount: number
}

const MEMORY_DIR = join(homedir(), '.edgecli')
const STATE_FILE = join(MEMORY_DIR, 'dream-state.json')
const LOCK_FILE = join(MEMORY_DIR, 'dream-lock.json')
const MIN_HOURS = 24
const MIN_SESSIONS = 5

function ensureDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true })
  }
}

function loadState(): DreamState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    } catch {}
  }
  return { lastConsolidatedAt: 0, sessionCount: 0 }
}

function saveState(state: DreamState) {
  ensureDir()
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ─── 锁机制（防并发）───────────────────────────────────────────────

function tryAcquireLock(): number | null {
  ensureDir()
  
  // 检查现有锁
  if (existsSync(LOCK_FILE)) {
    try {
      const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'))
      const age = Date.now() - lock.acquiredAt
      // 锁超过 1 小时视为过期（进程可能崩溃）
      if (age < 60 * 60 * 1000) {
        return null  // 锁有效，获取失败
      }
    } catch {}
  }
  
  // 获取锁
  const priorMtime = existsSync(STATE_FILE) 
    ? statmtime(STATE_FILE) 
    : 0
  writeFileSync(LOCK_FILE, JSON.stringify({ 
    acquiredAt: Date.now(),
    priorMtime 
  }))
  return priorMtime
}

function releaseLock() {
  if (existsSync(LOCK_FILE)) {
    unlinkSync(LOCK_FILE)
  }
}

function rollbackLock(priorMtime: number) {
  // 回滚：恢复 state 的 mtime 逻辑（时间门会重新触发）
  releaseLock()
}

function statmtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

// ─── 触发条件 ──────────────────────────────────────────────────────

export function shouldConsolidate(): boolean {
  const state = loadState()
  const now = Date.now()
  const hoursSince = (now - state.lastConsolidatedAt) / (1000 * 60 * 60)

  if (hoursSince < MIN_HOURS) return false
  if (state.sessionCount < MIN_SESSIONS) return false
  
  return true
}

export function recordSession() {
  const state = loadState()
  state.sessionCount++
  saveState(state)
}

// ─── 记忆整理核心 ──────────────────────────────────────────────────

interface ConsolidatedMemory {
  date: string
  summary: string
  keyDecisions: string[]
  lessonsLearned: string[]
  pendingItems: string[]
}

function extractKeyInfo(content: string): ConsolidatedMemory {
  const lines = content.split('\n')
  const summary: string[] = []
  const decisions: string[] = []
  const lessons: string[] = []
  const pending: string[] = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    
    // 提取待办
    if (trimmed.startsWith('- [ ]')) {
      pending.push(trimmed.replace('- [ ]', '').trim())
    }
    // 提取教训
    else if (trimmed.toLowerCase().includes('教训') || trimmed.toLowerCase().includes('lesson')) {
      lessons.push(trimmed.replace(/^[-#*]\s*/, '').trim())
    }
    // 提取决策
    else if (trimmed.toLowerCase().includes('决定') || trimmed.toLowerCase().includes('commit')) {
      decisions.push(trimmed.replace(/^[-#*]\s*/, '').trim())
    }
    // 其他内容作为摘要
    else if (trimmed.startsWith('##') || trimmed.startsWith('-')) {
      summary.push(trimmed.replace(/^#+\s*/, '').trim())
    }
  }
  
  return {
    date: '',
    summary: summary.slice(0, 5).join('; '),
    keyDecisions: decisions.slice(0, 3),
    lessonsLearned: lessons.slice(0, 3),
    pendingItems: pending.slice(0, 5),
  }
}

// ─── 主整理函数 ────────────────────────────────────────────────────

export async function consolidateMemory(): Promise<{ 
  success: boolean
  filesProcessed: number
  summary: string 
}> {
  // 1. 锁门
  const priorMtime = tryAcquireLock()
  if (priorMtime === null) {
    return { success: false, filesProcessed: 0, summary: '已有整理进程在运行' }
  }
  
  try {
    const state = loadState()
    const memoryDir = join(MEMORY_DIR, 'memory')
    let filesProcessed = 0
    const results: string[] = []
    
    // 读取最近 7 天日记
    if (existsSync(memoryDir)) {
      const files = readdirSync(memoryDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .slice(-7)
      
      for (const file of files) {
        const content = readFileSync(join(memoryDir, file), 'utf-8')
        if (content.trim()) {
          const extracted = extractKeyInfo(content)
          extracted.date = file.replace('.md', '')
          results.push(`[${extracted.date}] ${extracted.summary.slice(0, 100)}`)
          filesProcessed++
        }
      }
    }
    
    // 读取 MEMORY.md
    const memoryFile = join(MEMORY_DIR, 'MEMORY.md')
    if (existsSync(memoryFile)) {
      const content = readFileSync(memoryFile, 'utf-8')
      const extracted = extractKeyInfo(content)
      if (extracted.pendingItems.length > 0) {
        results.push(`[MEMORY.md] ${extracted.pendingItems.length} 个待办`)
      }
      filesProcessed++
    }
    
    // 更新状态
    state.lastConsolidatedAt = Date.now()
    state.sessionCount = 0
    saveState(state)
    
    // 释放锁
    releaseLock()
    
    const summary = `整理了 ${filesProcessed} 个文件：\n${results.join('\n')}`
    
    return { success: true, filesProcessed, summary }
  } catch (e: any) {
    rollbackLock(priorMtime)
    return { success: false, filesProcessed: 0, summary: `整理失败: ${e.message}` }
  }
}

// ─── 状态查询 ──────────────────────────────────────────────────────

export function getDreamStatus(): {
  shouldConsolidate: boolean
  hoursSinceLast: number
  sessionsSinceLast: number
  nextTriggerIn: string
} {
  const state = loadState()
  const now = Date.now()
  const hoursSince = (now - state.lastConsolidatedAt) / (1000 * 60 * 60)
  
  const hoursLeft = Math.max(0, MIN_HOURS - hoursSince)
  const sessionsLeft = Math.max(0, MIN_SESSIONS - state.sessionCount)
  
  let nextTrigger = ''
  if (hoursLeft > 0) {
    nextTrigger = `${Math.round(hoursLeft)} 小时后（时间门）`
  } else if (sessionsLeft > 0) {
    nextTrigger = `${sessionsLeft} 个会话后（会话门）`
  } else {
    nextTrigger = '随时可触发'
  }
  
  return {
    shouldConsolidate: shouldConsolidate(),
    hoursSinceLast: Math.round(hoursSince * 10) / 10,
    sessionsSinceLast: state.sessionCount,
    nextTriggerIn: nextTrigger,
  }
}
