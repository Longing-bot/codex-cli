// ─── 权限分级系统（5 级）─────────────────────────────────────────────────
// 权限等级：ReadOnly < WorkspaceWrite < DangerFullAccess < Prompt < Allow

export enum PermissionLevel {
  ReadOnly = 0,
  WorkspaceWrite = 1,
  DangerFullAccess = 2,
  Prompt = 3,
  Allow = 4,
}

export const PERMISSION_NAMES: Record<PermissionLevel, string> = {
  [PermissionLevel.ReadOnly]: 'ReadOnly',
  [PermissionLevel.WorkspaceWrite]: 'WorkspaceWrite',
  [PermissionLevel.DangerFullAccess]: 'DangerFullAccess',
  [PermissionLevel.Prompt]: 'Prompt',
  [PermissionLevel.Allow]: 'Allow',
}

// 工具 → 最低权限等级
const TOOL_PERMISSIONS: Record<string, PermissionLevel> = {
  read_file: PermissionLevel.ReadOnly,
  glob: PermissionLevel.ReadOnly,
  grep: PermissionLevel.ReadOnly,
  fetch: PermissionLevel.ReadOnly,
  web_search: PermissionLevel.ReadOnly,
  write_file: PermissionLevel.WorkspaceWrite,
  edit_file: PermissionLevel.WorkspaceWrite,
  todo_write: PermissionLevel.WorkspaceWrite,
  bash: PermissionLevel.DangerFullAccess,
  agent: PermissionLevel.DangerFullAccess,
  tool_search: PermissionLevel.ReadOnly,
}

// 当前权限模式
let currentLevel: PermissionLevel = PermissionLevel.WorkspaceWrite

export function getPermissionLevel(): PermissionLevel {
  return currentLevel
}

export function setPermissionLevel(level: PermissionLevel | string): boolean {
  if (typeof level === 'string') {
    const map: Record<string, PermissionLevel> = {
      'ReadOnly': PermissionLevel.ReadOnly,
      'WorkspaceWrite': PermissionLevel.WorkspaceWrite,
      'DangerFullAccess': PermissionLevel.DangerFullAccess,
      'Prompt': PermissionLevel.Prompt,
      'Allow': PermissionLevel.Allow,
    }
    const found = map[level]
    if (found === undefined) return false
    currentLevel = found
    return true
  }
  currentLevel = level
  return true
}

export function checkPermission(toolName: string): { allowed: boolean; level: PermissionLevel; reason?: string } {
  const requiredLevel = TOOL_PERMISSIONS[toolName] ?? PermissionLevel.DangerFullAccess
  if (currentLevel >= requiredLevel) {
    return { allowed: true, level: requiredLevel }
  }
  return {
    allowed: false,
    level: requiredLevel,
    reason: `工具 ${toolName} 需要 ${PERMISSION_NAMES[requiredLevel]} 权限，当前模式为 ${PERMISSION_NAMES[currentLevel]}`,
  }
}

export function getToolPermissionLevel(toolName: string): PermissionLevel {
  return TOOL_PERMISSIONS[toolName] ?? PermissionLevel.DangerFullAccess
}

export function listPermissions(): string {
  const lines = [
    `当前权限模式: ${PERMISSION_NAMES[currentLevel]}`,
    '',
    '工具权限映射:',
  ]
  for (const [tool, level] of Object.entries(TOOL_PERMISSIONS).sort((a, b) => a[1] - b[1])) {
    const marker = level <= currentLevel ? '✅' : '🚫'
    lines.push(`  ${marker} ${tool} → ${PERMISSION_NAMES[level]}`)
  }
  return lines.join('\n')
}
