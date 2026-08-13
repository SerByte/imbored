import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GameArt } from '@/components/GameArt'
import { WarmCatalog } from '@/components/WarmCatalog'
import { feedbackStats, getGamesMeta, getLatestSnapshot } from '@/lib/db'
import { classifyLibraryGame, type LibraryGameState } from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { backlogEquivalent, backlogValue } from '@/lib/stats'

export const dynamic = 'force-dynamic'

const STATE_LABEL: Record<LibraryGameState, { text: string; cls: string }> = {
  active: { text: 'играешь сейчас', cls: 'text-ember' },
  unplayed: { text: 'не распакована', cls: 'text-sky-300/80' },
  comeback: { text: 'заброшена', cls: 'text-dim' },
  played: { text: '', cls: 'text-dim' },
}

export default async function LibraryPage() {
  const steamid = await currentSteamId()
  if (!steamid) redirect('/')

  const db = await getDb()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) redirect('/')

  const now = nowSec()
  const games = [...snapshot.games].sort((a, b) => b.playtimeForever - a.playtimeForever)
  const totalHours = Math.round(games.reduce((s, g) => s + g.playtimeForever, 0) / 60)
  const unplayed = games.filter((g) => classifyLibraryGame(g, now) === 'unplayed').length

  // Только игры библиотеки, а не весь каталог: нужны обложки для сетки и
  // цена бэклога, и то и другое считается по своим играм
  const metas = await getGamesMeta(
    db,
    games.map((g) => g.appid),
  )
  const backlog = backlogValue(games, (id) => metas.get(id), now)
  // Строка разрезается по {n}, чтобы число осталось моноширинным, как все
  // числа в проекте, а не растворилось в тексте
  const equivalent = (() => {
    const eq = backlogEquivalent(backlog.cents, steamid)
    if (!eq) return null
    const [before, after] = eq.text.split('{n}')
    return { count: eq.count, before, after }
  })()
  const stats = await feedbackStats(db, steamid)
  // В библиотеку можно зайти в обход подбора: если обложек ещё нет — догреем
  const missingArt = games.filter((g) => !metas.get(g.appid)?.headerImage).length

  return (
    <div className="flex-1 mx-auto w-full max-w-6xl px-5 pt-28 pb-16">
      <WarmCatalog enabled={missingArt > 0} />
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
          Твоя библиотека глазами сервиса
        </h1>
        <Link
          href="/portrait"
          className="rounded-[14px] glass glass-hover px-4 py-2 text-sm shrink-0"
        >
          Мой портрет игрока →
        </Link>
      </div>
      <p className="text-dim text-sm mb-6">
        <span className="font-mono">{games.length}</span> игр ·{' '}
        <span className="font-mono">{totalHours.toLocaleString('ru-RU')}</span> часов ·{' '}
        <span className="font-mono">{unplayed}</span> так и не распакованы
      </p>

      {(backlog.pricedCount > 0 || stats.rate !== null) && (
        <div className="grid md:grid-cols-2 gap-4 mb-10">
          {backlog.pricedCount > 0 && (
            <div className="glass rounded-[20px] p-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-lg font-bold">
                  ≥ <span className="font-mono text-ember">${(backlog.cents / 100).toFixed(0)}</span>{' '}
                  лежит несыгранным
                </div>
                <div className="text-xs text-dim mt-1">
                  {backlog.unplayedCount} нераспакованных игр, у {backlog.pricedCount} известна цена
                </div>
                {equivalent && (
                  <div className="text-xs text-dim mt-2">
                    {equivalent.before}
                    <span className="font-mono text-ember">{equivalent.count}</span>
                    {equivalent.after}
                  </div>
                )}
              </div>
              <Link
                href="/quiz"
                className="shrink-0 rounded-[14px] bg-ember text-bg font-semibold px-4 py-2.5 text-sm hover:brightness-110 transition"
              >
                Разгрести →
              </Link>
            </div>
          )}
          {stats.rate !== null && (
            <div className="glass rounded-[20px] p-5">
              <div className="text-lg font-bold">
                Подбор попадает в{' '}
                <span className="font-mono text-ember">{Math.round(stats.rate * 100)}%</span>
              </div>
              <div className="text-xs text-dim mt-1">
                {stats.liked} «зашло» против {stats.skipped} «не то»
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {games.map((g) => {
          const state = classifyLibraryGame(g, now)
          const label = STATE_LABEL[state]
          const hours = Math.round(g.playtimeForever / 60)
          return (
            <Link
              key={g.appid}
              href={`/game/${g.appid}`}
              className={`library-tile glass glass-hover rounded-[14px] overflow-hidden ${
                state === 'comeback' ? 'opacity-75 hover:opacity-100' : ''
              }`}
            >
              <GameArt
                appid={g.appid}
                name={g.name}
                headerImage={metas.get(g.appid)?.headerImage ?? null}
                art={metas.get(g.appid)?.art ?? null}
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                className="w-full aspect-[460/215] object-cover"
              />
              <div className="p-3">
                <div className="text-sm font-semibold leading-tight truncate">{g.name}</div>
                <div className="text-[11px] mt-1 flex items-center justify-between">
                  <span className="font-mono text-dim">
                    {hours > 0 ? `${hours} ч` : g.playtimeForever > 0 ? `${g.playtimeForever} мин` : '0 ч'}
                  </span>
                  {label.text && <span className={label.cls}>{label.text}</span>}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
