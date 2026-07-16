export interface DiffLine {
  type: 'same' | 'added' | 'removed'
  text: string
  lineNumber?: number
}

export function createLineDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split(/\r?\n/)
  const newLines = newContent.split(/\r?\n/)
  const max = Math.max(oldLines.length, newLines.length)
  const lines: DiffLine[] = []

  for (let index = 0; index < max; index += 1) {
    const oldLine = oldLines[index]
    const newLine = newLines[index]

    if (oldLine === newLine) {
      lines.push({ type: 'same', text: oldLine ?? '', lineNumber: index + 1 })
      continue
    }

    if (oldLine !== undefined) {
      lines.push({ type: 'removed', text: oldLine, lineNumber: index + 1 })
    }

    if (newLine !== undefined) {
      lines.push({ type: 'added', text: newLine, lineNumber: index + 1 })
    }
  }

  return lines
}
