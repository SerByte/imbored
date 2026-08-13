import Link from 'next/link'
import type { StoredNews } from '@/lib/db'
import type { GameMeta } from '@/lib/types'
import { GameArt } from './GameArt'
import { NewsBody } from './NewsBody'

/** Метка масштаба. Крупное подсвечиваем, мелкое — приглушаем. */
export function ScaleBadge({ scale }: { scale: StoredNews['scale'] }) {
  if (!scale) return null
  const major = scale === 'major'
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs shrink-0 ${
        major ? 'bg-ember/15 text-ember' : 'glass text-dim'
      }`}
    >
      {major ? 'Крупное' : 'Хотфикс'}
    </span>
  )
}

export function NewsDate({ at, className = '' }: { at: number; className?: string }) {
  const d = new Date(at * 1000)
  return (
    <time dateTime={d.toISOString()} className={`font-mono tabular-nums text-xs text-dim ${className}`}>
      {d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
    </time>
  )
}

/**
 * Карточка патча в ленте «Что нового»: обложка игры, что изменилось и когда.
 * Полное тело здесь не разворачивается — за ним идут на страницу игры.
 */
export function NewsCard({ item, meta }: { item: StoredNews; meta?: GameMeta }) {
  const name = meta?.name ?? `Игра ${item.appid}`
  return (
    <article className="glass glass-hover rounded-[20px] p-5 anim-reveal">
      <div className="flex gap-4">
        <Link href={`/game/${item.appid}`} className="shrink-0 w-[132px] hidden sm:block">
          <GameArt
            appid={item.appid}
            name={name}
            headerImage={meta?.headerImage}
            art={meta?.art}
            variant="card"
            sizes="132px"
            className="aspect-[460/215] rounded-[14px] border border-edge"
          />
        </Link>

        <div className="min-w-0 flex-1 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <Link
              href={`/game/${item.appid}`}
              className="text-sm font-semibold text-ink hover:text-ember transition-colors"
            >
              {name}
            </Link>
            <ScaleBadge scale={item.scale} />
          </div>

          <h2 className="text-base font-medium text-ink leading-snug">{item.title}</h2>

          {item.tldr ? (
            <p className="text-sm text-dim leading-relaxed">{item.tldr}</p>
          ) : (
            <NewsBody blocks={item.blocks.slice(0, 2)} />
          )}

          <div className="flex items-center gap-4 mt-1">
            <NewsDate at={item.publishedAt} />
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-dim hover:text-ink transition-colors"
            >
              Оригинал в Steam
            </a>
          </div>
        </div>
      </div>
    </article>
  )
}
