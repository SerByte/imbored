import type { Metadata } from 'next'
import Link from 'next/link'
import { Cover } from '@/components/whatsnew/Cover'
import { PatchRow } from '@/components/whatsnew/PatchRow'
import { Stage } from '@/components/whatsnew/Stage'
import { artCandidates } from '@/lib/art'
import {
  getFeedForApps,
  getGamesMeta,
  getLatestSnapshot,
  getMajorFeed,
  type StoredNews,
} from '@/lib/db'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Что нового',
  description: 'Крупные обновления игр: что изменилось в твоей библиотеке и в популярных играх.',
}

/** Сколько игр библиотеки берём в личную ленту */
const LIBRARY_CAP = 300
const FEED_LIMIT = 30

/**
 * Лента обновлений.
 *
 * Страница остаётся серверной: тянуть на клиент нечего — тела патчей уже
 * приезжают из базы целиком. Клиентских островков ровно три, и у каждого есть
 * причина существовать: Cover (параллакс от скролла), Stage (наблюдатель за
 * активной строкой), PatchRow (раскрытие). Всё остальное — обычная разметка.
 *
 * Первый элемент уходит в обложку, а не дублируется в ленте: он и так самый
 * свежий, и повторять его строкой значило бы показать одно обновление дважды.
 */
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

  const now = nowSec()
  const [hero, ...rest] = items

  if (!hero) {
    return (
      <div className="whatsnew flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Что нового</h1>
        <p className="max-w-sm text-sm leading-relaxed text-dim">
          Пока пусто. Обновления подтягиваются по расписанию — загляни попозже.
        </p>
        <Link
          href="/quiz"
          className="text-sm font-semibold underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
        >
          А пока подобрать игру →
        </Link>
      </div>
    )
  }

  const heroMeta = metas.get(hero.appid)

  return (
    <div className="whatsnew min-h-screen">
      <Stage
        initialWash={
          artCandidates(
            { appid: hero.appid, art: heroMeta?.art, headerImage: heroMeta?.headerImage },
            'hero',
          )[0]
        }
      >
        <Cover item={hero} meta={heroMeta} nowSec={now} />

        <div className="mx-auto w-full max-w-6xl px-5 pb-24">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule py-6">
            <h2 className="font-display text-lg font-bold tracking-tight md:text-xl">
              {personal ? 'В твоих играх' : 'В популярных играх'}
            </h2>
            <p className="text-sm text-dim">
              {personal ? (
                'Только крупные патчи. Мелкие правки — на странице игры.'
              ) : (
                <>
                  Только крупные патчи.{' '}
                  <Link
                    href="/"
                    className="font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
                  >
                    Подключи Steam
                  </Link>{' '}
                  — и лента станет про твои игры.
                </>
              )}
            </p>
          </div>

          {rest.map((item) => (
            <PatchRow
              key={`${item.appid}:${item.gid}`}
              item={item}
              meta={metas.get(item.appid)}
              nowSec={now}
            />
          ))}
        </div>
      </Stage>
    </div>
  )
}
