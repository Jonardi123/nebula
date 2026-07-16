import { File, Folder, Monitor, Terminal } from 'lucide-react'
import clsx from 'clsx'
import { lazy, Suspense } from 'react'
import type { ChatMessage } from '../types/agent'
import { formatTime } from '../lib/logger'
import { NebulaGlyph } from './NebulaGlyph'

const MarkdownContent = lazy(() => import('./MarkdownContent'))

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const isError = /^(?:LM Studio|Nebula) error:|request failed:/i.test(message.content.trim())

  return (
    <div className={clsx('message-row flex gap-3', isUser && 'justify-end')}>
      {!isUser && (
        <div className={clsx('message-avatar mt-1 grid h-8 w-8 shrink-0 place-items-center text-slate-300', !isTool && 'message-avatar-nebula', isError && 'message-avatar-error')} aria-label={isTool ? 'Tool result' : 'Nebula'}>
          {isTool ? <Terminal size={15} /> : <NebulaGlyph state={isError ? 'error' : 'idle'} />}
        </div>
      )}
      <article
        className={clsx(
          'message-bubble max-w-[82%] px-4 py-3 text-sm leading-6',
          isUser
            ? 'message-user text-cyan-50'
            : message.role === 'tool'
              ? 'message-tool text-emerald-50'
              : 'message-assistant text-slate-100',
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase text-slate-500">
          <span>{message.role}</span>
          <span>{formatTime(message.createdAt)}</span>
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((attachment) => {
              const AttachmentIcon = attachment.kind === 'folder' ? Folder : attachment.kind === 'screen' ? Monitor : File
              return <span key={attachment.id} title={attachment.path || attachment.detail}><AttachmentIcon size={11} />{attachment.label}</span>
            })}
          </div>
        )}
        <div className="nebula-markdown">
          <Suspense fallback={<pre className="whitespace-pre-wrap break-words font-sans">{message.content || '...'}</pre>}>
            <MarkdownContent content={message.content || '...'} />
          </Suspense>
        </div>
      </article>
    </div>
  )
}
