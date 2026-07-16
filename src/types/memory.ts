export type MemoryFile =
  | 'user.md'
  | 'projects.md'
  | 'web_learnings.md'
  | 'pc_fixes.md'
  | 'lessons_learned.md'
  | 'commands.md'
  | 'preferences.md'

export interface MemorySearchResult {
  file: MemoryFile
  line: number
  text: string
}
