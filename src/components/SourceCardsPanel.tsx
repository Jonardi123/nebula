import { BookMarked, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { notify } from '../lib/notifications'
import { getSourceCards, saveSourceCardToMemory } from '../lib/sourceCards'
import type { LogEvent } from '../types/agent'
import type { SourceCard } from '../types/nebula'

export function SourceCardsPanel({
  onLog,
}: {
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}) {
  const [cards, setCards] = useState<SourceCard[]>([])

  function refresh() {
    setCards(getSourceCards())
  }

  async function save(card: SourceCard) {
    try {
      saveSourceCardToMemory(card.id)
      refresh()
      onLog('memory', `Memory proposal created from source: ${card.url}`)
      await notify({
        type: 'memory_proposal',
        title: 'Source memory proposal',
        message: card.title,
        data: card,
      })
    } catch (error) {
      onLog('error', `Source save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  useEffect(() => {
    refresh()
    const listener = () => refresh()
    window.addEventListener('nebula-sources-changed', listener)
    return () => window.removeEventListener('nebula-sources-changed', listener)
  }, [])

  return (
    <div className="space-y-3 p-3 text-xs">
      <button className="nebula-button-primary flex w-full items-center justify-center gap-2 px-3 py-2" type="button" onClick={refresh}>
        <RefreshCw size={13} />
        Refresh Sources
      </button>

      {cards.length === 0 && <div className="nebula-note p-3 text-slate-400">Web research source cards will appear here after search or fetch tools run.</div>}

      {cards.map((card) => (
        <section key={card.id} className="skill-card rounded-md border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-100">{card.title}</h3>
              <a className="mt-1 block truncate text-[11px] text-cyan-200 hover:text-cyan-100" href={card.url} target="_blank" rel="noreferrer">
                {card.url}
              </a>
            </div>
            <button className="nebula-toggle flex shrink-0 items-center gap-1 px-2 py-1" type="button" onClick={() => save(card)}>
              <BookMarked size={12} />
              {card.savedToMemory ? 'Saved' : 'Memory'}
            </button>
          </div>
          <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-xs leading-5 text-slate-300">{card.summary || card.snippet}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {card.trustHints.map((hint) => (
              <span key={hint} className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                {hint}
              </span>
            ))}
            <span className="rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100">
              checked {new Date(card.dateChecked).toLocaleDateString()}
            </span>
          </div>
        </section>
      ))}
    </div>
  )
}
