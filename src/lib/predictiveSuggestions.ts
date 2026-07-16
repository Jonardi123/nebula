import { selectSkillsForRequest, getEnabledSkills } from '../skills'
import type { PredictiveSuggestion, WorkspaceAwarenessSnapshot } from '../types/nebula'

function extension(path: string) {
  return path.split(/[\\/]/).pop()?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
}

function base(path: string) {
  return path.split(/[\\/]/).pop()?.toLowerCase() ?? path.toLowerCase()
}

function confidenceFor(text: string) {
  const matches = selectSkillsForRequest(getEnabledSkills(), text, 3)
  return Math.max(42, ...matches.map((match) => match.confidence))
}

export function suggestionsForFile(path?: string, workspace?: WorkspaceAwarenessSnapshot | null): PredictiveSuggestion[] {
  if (!path) return []
  const name = base(path)
  const ext = extension(path)
  const suggestions: Array<Omit<PredictiveSuggestion, 'id' | 'confidence'>> = []

  if (name === 'package.json') {
    suggestions.push(
      { label: 'Review package', reason: 'package.json controls scripts and dependencies.', actionId: 'review-project', target: path },
      { label: 'Explain project', reason: 'Package metadata can identify the app shape.', actionId: 'explain-current-file', target: path },
      { label: 'Search vulnerabilities', reason: 'Dependencies may need external verification.', actionId: 'search-project', target: path },
    )
  } else if (/^readme/i.test(name) || ext === 'md') {
    suggestions.push(
      { label: 'Summarize', reason: 'Documentation is useful workspace context.', actionId: 'summarize-readme', target: path },
      { label: 'Improve', reason: 'README quality affects project usability.', actionId: 'optimize-code', target: path },
      { label: 'Explain', reason: 'Markdown often describes project intent.', actionId: 'explain-current-file', target: path },
    )
  } else if (['ts', 'tsx', 'js', 'jsx', 'rs', 'css'].includes(ext)) {
    suggestions.push(
      { label: 'Review', reason: 'Code file selected.', actionId: 'find-bugs', target: path },
      { label: 'Explain', reason: 'Selected code can be summarized from context.', actionId: 'explain-current-file', target: path },
      { label: 'Optimize', reason: 'Code may have focused improvement opportunities.', actionId: 'optimize-code', target: path },
    )
  }

  if (workspace?.recentErrors.length) {
    suggestions.unshift({
      label: 'Investigate recent error',
      reason: 'Workspace awareness observed recent errors.',
      actionId: 'find-bugs',
      target: path,
    })
  }

  return suggestions.slice(0, 4).map((suggestion) => ({
    id: `${suggestion.actionId}:${suggestion.target ?? 'workspace'}:${suggestion.label}`,
    confidence: confidenceFor(`${suggestion.label} ${suggestion.reason} ${path}`),
    ...suggestion,
  }))
}
