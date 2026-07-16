import clsx from 'clsx'

type NebulaGlyphState = 'idle' | 'thinking' | 'reviewing' | 'tool' | 'error'

interface Props {
  state?: NebulaGlyphState
  className?: string
}

export function NebulaGlyph({ state = 'idle', className }: Props) {
  return (
    <span className={clsx('nebula-glyph', `nebula-glyph-${state}`, className)} aria-hidden="true">
      <span className="nebula-glyph-haze" />
      <span className="nebula-glyph-ring nebula-glyph-ring-a" />
      <span className="nebula-glyph-ring nebula-glyph-ring-b" />
      <span className="nebula-glyph-core" />
    </span>
  )
}
