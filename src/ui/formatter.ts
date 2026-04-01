// ─── 输出格式化（CC OutputLine 风格）───────────────────────────────────────
// CC 自动格式化 JSON 输出，添加超链接，截断长输出

const MAX_JSON_LENGTH = 10_000

// JSON 自动格式化（CC tryFormatJson 风格）
export function tryFormatJson(line: string): string {
  try {
    const parsed = JSON.parse(line)
    const stringified = JSON.stringify(parsed)
    // 精度检查
    if (line.replace(/\s+/g, '') !== stringified.replace(/\s+/g, '')) {
      return line
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return line
  }
}

export function tryJsonFormatContent(content: string): string {
  if (content.length > MAX_JSON_LENGTH) return content
  return content.split('\n').map(tryFormatJson).join('\n')
}

// URL 超链接化（CC linkifyUrls 风格）
const URL_RE = /https?:\/\/[^\s"'<>\\]+/g

export function linkifyUrls(content: string): string {
  return content.replace(URL_RE, url => `\u001B]8;;${url}\u0007${url}\u001B]8;;\u0007`)
}

// 截断输出（CC renderTruncatedContent 风格）
export function truncateOutput(content: string, maxLines: number = 20, maxChars: number = 2000): string {
  const lines = content.split('\n')

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join('\n') + `\n… (${lines.length - maxLines} 行已隐藏)`
  }

  if (content.length > maxChars) {
    return content.slice(0, maxChars) + `\n… (${content.length - maxChars} 字符已截断)`
  }

  return content
}

// 格式化工具输出
export function formatToolOutput(toolName: string, content: string): string {
  switch (toolName) {
    case 'bash': {
      // 尝试 JSON 格式化
      const formatted = tryJsonFormatContent(content)
      return truncateOutput(formatted)
    }
    case 'read_file':
      return truncateOutput(content, 30, 3000)
    default:
      return truncateOutput(content)
  }
}
