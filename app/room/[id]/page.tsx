'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { LogoMark } from '@/components/Logo'
import { STORE_LABEL } from '@/lib/stores'

type RoomState = {
  room: { id: string; status: 'open' | 'matched'; matchedAppid: number | null; isPublic: boolean }
  isHost: boolean
  members: Array<{ name: string; me: boolean; votes: number }>
  hasSession: boolean
  isMember: boolean
  matchedGame: {
    appid: number
    name: string
    headerImage: string | null
    store: string | null
    storeUrl: string | null
  } | null
}

type Card = {
  appid: number
  name: string
  ownedByAll: boolean
  missingFor: string[]
  priceFinal?: number
  headerImage: string | null
  tags: string[]
  store?: string
  storeUrl?: string
}

export default function RoomPage() {
  const params = useParams<{ id: string }>()
  const roomId = (params.id ?? '').toUpperCase()

  const [state, setState] = useState<RoomState | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [deckTotal, setDeckTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const deckLoaded = useRef(false)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/room/${roomId}`)
    if (res.status === 404) {
      setNotFound(true)
      return
    }
    setState((await res.json()) as RoomState)
  }, [roomId])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 2500)
    return () => clearInterval(t)
  }, [refresh])

  // колода подгружается один раз после членства
  useEffect(() => {
    if (!state?.isMember || deckLoaded.current) return
    deckLoaded.current = true
    void (async () => {
      const res = await fetch(`/api/room/${roomId}/deck`)
      if (!res.ok) return
      const data = (await res.json()) as { cards: Card[]; total: number }
      setCards(data.cards)
      setDeckTotal(data.total)
    })()
  }, [state?.isMember, roomId])

  async function joinAsDemoFriend() {
    setBusy(true)
    await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo: true, variant: 2 }),
    })
    await fetch(`/api/room/${roomId}/join`, { method: 'POST' })
    setBusy(false)
    void refresh()
  }

  async function join() {
    setBusy(true)
    await fetch(`/api/room/${roomId}/join`, { method: 'POST' })
    setBusy(false)
    void refresh()
  }

  async function vote(card: Card, yes: boolean) {
    setCards((prev) => (prev ? prev.filter((c) => c.appid !== card.appid) : prev))
    const res = await fetch(`/api/room/${roomId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid: card.appid, vote: yes }),
    })
    const data = (await res.json()) as { matched: number | null }
    if (data.matched !== null) void refresh()
  }

  function copyLink() {
    void navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">Такой комнаты нет.</p>
        <Link href="/room/new" className="text-ember hover:underline text-sm">
          Создать свою →
        </Link>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-2 border-white/15 border-t-ember animate-spin" />
      </div>
    )
  }

  // ---- МАТЧ ----
  if (state.room.status === 'matched' && state.matchedGame) {
    const g = state.matchedGame
    return (
      <div className="media-dark relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
        {g.headerImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={g.headerImage}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover blur-3xl opacity-30 scale-110"
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: 'radial-gradient(60% 60% at 50% 45%, transparent, #0b0c10 90%)' }}
        />
        <div className="relative max-w-lg w-full text-center flex flex-col items-center gap-5 anim-reveal">
          <LogoMark size={56} happy />
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Это матч!</h1>
          <p className="text-dim">Все в комнате хотят играть в одно и то же:</p>
          {g.headerImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={g.headerImage}
              alt={g.name}
              className="w-full max-w-md rounded-[20px] border border-edge"
            />
          )}
          <div className="text-2xl font-bold">{g.name}</div>
          {g.storeUrl ? (
            <a
              href={g.storeUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-[14px] bg-ember text-bg font-semibold px-8 py-3 hover:brightness-110 transition"
            >
              Открыть в {STORE_LABEL[g.store ?? ''] ?? 'магазине'}
            </a>
          ) : (
            <a
              href={`steam://run/${g.appid}`}
              className="rounded-[14px] bg-ember text-bg font-semibold px-8 py-3 hover:brightness-110 transition"
            >
              Запустить в Steam
            </a>
          )}
          <p className="text-xs text-dim/60">Зови всех в войс — договорились же.</p>
        </div>
      </div>
    )
  }

  // ---- НЕ УЧАСТНИК ----
  if (!state.isMember) {
    return (
      <div className="relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
        <Ambient />
        <div className="relative max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col gap-4 anim-rise">
          <h1 className="text-2xl font-bold tracking-tight">Тебя зовут выбрать игру на вечер</h1>
          <p className="text-dim text-sm">
            Комната <span className="font-mono text-ink">{roomId}</span>. Подключи свою библиотеку —
            и свайпай, во что готов играть. Совпадёте — будет матч.
          </p>
          {state.hasSession ? (
            <button
              onClick={join}
              disabled={busy}
              className="rounded-[14px] bg-ember text-bg font-semibold py-3 hover:brightness-110 transition disabled:opacity-40"
            >
              Войти в комнату
            </button>
          ) : (
            <>
              <a
                href={`/api/auth/steam?join=${roomId}`}
                className="rounded-[14px] bg-ember text-bg font-semibold py-3 hover:brightness-110 transition"
              >
                Войти через Steam
              </a>
              <Link
                href={`/?join=${roomId}`}
                className="rounded-[14px] glass glass-hover py-3 text-sm"
              >
                Вставить ссылку на профиль
              </Link>
              <button
                onClick={joinAsDemoFriend}
                disabled={busy}
                className="text-sm text-dim hover:text-ink transition-colors"
              >
                {busy ? 'Подключаю…' : 'Демо-друг (без Steam)'}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ---- ЛОББИ + СВАЙП ----
  const card = cards?.[0]
  const votedCount = cards ? deckTotal - cards.length : 0

  return (
    <div className="flex-1 mx-auto w-full max-w-2xl px-5 pt-24 pb-16 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Пати <span className="font-mono text-ember">{roomId}</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">Совпадут голоса всех — будет матч</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {state.isHost && (
            <button
              onClick={async () => {
                await fetch(`/api/room/${roomId}/public`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ public: !state.room.isPublic }),
                })
                void refresh()
              }}
              className={`rounded-[14px] px-4 py-2 text-sm cursor-pointer transition ${
                state.room.isPublic
                  ? 'bg-ember/15 text-ember'
                  : 'glass glass-hover text-dim'
              }`}
              title="Открытая комната видна на доске «Пати» — к вам смогут подсесть"
            >
              {state.room.isPublic ? 'На доске ✓' : 'Показать на доске'}
            </button>
          )}
          <button
            onClick={copyLink}
            className="rounded-[14px] glass glass-hover px-4 py-2 text-sm cursor-pointer"
          >
            {copied ? 'Скопировано ✓' : 'Скопировать ссылку для друзей'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {state.members.map((m) => (
          <span
            key={m.name + String(m.me)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              m.me ? 'bg-ember/15 text-ember' : 'glass text-dim'
            }`}
          >
            {m.name}
            {m.me ? ' (ты)' : ''} · <span className="font-mono">{m.votes}</span> голосов
          </span>
        ))}
      </div>

      {cards === null ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 rounded-full border-2 border-white/15 border-t-ember animate-spin" />
        </div>
      ) : card ? (
        <div key={card.appid} className="glass rounded-[20px] overflow-hidden anim-reveal">
          {card.headerImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.headerImage} alt="" className="w-full aspect-[460/215] object-cover" />
          ) : (
            <div className="w-full aspect-[460/215] flex items-center justify-center bg-white/5 text-2xl font-bold px-6 text-center">
              {card.name}
            </div>
          )}
          <div className="p-6 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-2xl font-bold tracking-tight">{card.name}</h2>
              {card.ownedByAll ? (
                <span className="rounded-full bg-emerald-400/15 text-emerald-300 px-3 py-1 text-xs font-medium">
                  ✓ Есть у всех
                </span>
              ) : (
                <span className="rounded-full bg-sky-400/10 text-sky-300 px-3 py-1 text-xs">
                  Нет у: {card.missingFor.join(', ')}
                  {card.priceFinal !== undefined && card.priceFinal > 0
                    ? ` · $${(card.priceFinal / 100).toFixed(0)}`
                    : card.store
                      ? ' · бесплатно/вне Steam'
                      : ''}
                </span>
              )}
            </div>
            {card.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {card.tags.map((t) => (
                  <span key={t} className="glass rounded-full px-3 py-1 text-xs text-dim">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                onClick={() => vote(card, false)}
                className="rounded-[14px] glass glass-hover py-5 text-lg cursor-pointer active:scale-[0.98] transition"
              >
                ✖ Не хочу
              </button>
              <button
                onClick={() => vote(card, true)}
                className="rounded-[14px] bg-ember text-bg font-bold py-5 text-lg hover:brightness-110 active:scale-[0.98] transition cursor-pointer"
              >
                Играем!
              </button>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-ember rounded-full transition-all duration-300"
                  style={{ width: `${deckTotal ? Math.round(((votedCount + 1) / deckTotal) * 100) : 0}%` }}
                />
              </div>
              <span className="text-xs text-dim/60 font-mono shrink-0">
                {votedCount + 1}/{deckTotal}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass rounded-[20px] p-8 text-center flex flex-col gap-3 anim-rise">
          <p className="font-semibold">Ты всё отсвайпал</p>
          <p className="text-dim text-sm">
            Ждём остальных. Матч появится сам, как только вкусы совпадут.
          </p>
        </div>
      )}
    </div>
  )
}
