// ─── Layer 2: REPL ─────────────────────────────────────────────────────────
// Read-Eval-Print Loop - handles user input, manages conversation state

import { loadSession, saveSession, type Message } from '../config/index.js'

export interface REPLState {
  messages: Message[]
  isRunning: boolean
  currentInput: string
}

export function createREPLState(): REPLState {
  return {
    messages: loadSession(),
    isRunning: false,
    currentInput: '',
  }
}
