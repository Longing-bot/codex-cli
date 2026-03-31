// ─── Diff 渲染（CC structuredPatch 风格）─────────────────────────────────────
import { structuredPatch } from 'diff'

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLine?: number
  newLine?: number
}

export function computeDiff(oldText: string, newText: string, filePath?: string): DiffLine[] {
  const patch = structuredPatch(filePath || 'file', filePath || 'file', oldText, newText)
  const lines: DiffLine[] = []

  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart

    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        lines.push({ type: 'add', content: line.slice(1), newLine: newLine++ })
      } else if (line.startsWith('-')) {
        lines.push({ type: 'remove', content: line.slice(1), oldLine: oldLine++ })
      } else {
        lines.push({ type: 'context', content: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
      }
    }
  }

  return lines
}
