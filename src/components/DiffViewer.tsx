import { createLineDiff } from '../lib/diff'

export function DiffViewer({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const lines = createLineDiff(oldContent, newContent)
  return (
    <div className="terminal-font max-h-64 overflow-auto rounded-md border border-slate-800 bg-slate-950 text-xs">
      {lines.map((line, index) => (
        <div
          key={`${line.type}-${index}`}
          className={
            line.type === 'added'
              ? 'grid grid-cols-[52px_1fr] bg-emerald-500/10 text-emerald-100'
              : line.type === 'removed'
                ? 'grid grid-cols-[52px_1fr] bg-red-500/10 text-red-100'
                : 'grid grid-cols-[52px_1fr] text-slate-400'
          }
        >
          <span className="select-none border-r border-slate-800 px-2 py-0.5 text-right text-slate-600">{line.lineNumber}</span>
          <span className="whitespace-pre-wrap px-2 py-0.5">{line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}{line.text}</span>
        </div>
      ))}
    </div>
  )
}
