import type { Metadata } from 'next'
import Link from 'next/link'
import { NewsCard } from '@/components/NewsCard'
import {
  getFeedForApps,
  getGamesMeta,
  getLatestSnapshot,
  getMajorFeed,
  type StoredNews,
} from '@/lib/db'
import { currentSteamId, getDb } from '@/lib/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Что нового — imbored',
  description: 'Крупные обновления игр: что изменилось в твоей библиотеке и в популярных играх.',
}

/** Сколько игр библиотеки берём в личную ленту */
const LIBRARY_CAP = 300
const FEED_LIMIT = 30

export default async function WhatsNewPage() {
  const steamid = await currentSteamId()
  const db = await getDb()

  let items: StoredNews[] = []
  let personal = false

  if (steamid) {
    const snapshot = await getLatestSnapshot(db, steamid)
    if (snapshot?.games.length) {
      const appids = [...snapshot.games]
        .sort((a, b) => b.playtimeForever - a.playtimeForever)
        .slice(0, LIBRARY_CAP)
        .map((g) => g.appid)
      items = await getFeedForApps(db, appids, FEED_LIMIT)
      personal = items.length > 0
    }
  }

  // гость, пустая библиотека или по своим играм пока ничего не приезжало
  if (!items.length) items = await getMajorFeed(db, FEED_LIMIT)

  const metas = await getGamesMeta(
    db,
    items.map((i) => i.appid),
  )

  return (
    <div className="mx-auto max-w-3xl px-5 pt-28 pb-16 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Что нового</h1>
        <p className="text-sm text-dim leading-relaxed">
          {personal
            ? 'Крупные обновления игр из твоей библиотеки. Мелкие правки и хотфиксы — на странице игры.'
            : 'Крупные обновления популярных игр. Подключи Steam — и здесь останутся только твои игры.'}
        </p>
      </header>

      {items.length ? (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <NewsCard key={`${item.appid}:${item.gid}`} item={item} meta={metas.get(item.appid)} />
          ))}
        </div>
      ) : (
        <div className="glass rounded-[20px] p-8 text-center flex flex-col gap-3">
          <p className="text-sm text-dim">
            Пока пусто. Обновления подтягиваются по расписанию — загляни попозже.
          </p>
          <Link href="/quiz" className="text-sm text-ember hover:underline underline-offset-2">
            А пока подобрать игру →
          </Link>
        </div>
      )}

      {!steamid && items.length > 0 && (
        <div className="glass rounded-[20px] p-5 text-center">
          <p className="text-sm text-dim">
            <Link href="/" className="text-ember hover:underline underline-offset-2">
              Подключи Steam
            </Link>{' '}
            — и лента станет про твои игры.
          </p>
        </div>
      )}
    </div>
  )
}
