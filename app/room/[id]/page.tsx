'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { useShareLink } from '@/components/ShareLink'
import { MatchCeremony } from '@/components/MatchCeremony'
import { RoomWaiting } from '@/components/room/RoomWaiting'
import { Spinner } from '@/components/Spinner'
import { SwipeDeck } from '@/components/SwipeDeck'
import type { LikedGame } from '@/components/room/LikesStrips'
import type { GameArtUrls } from '@/lib/art'
import type { Discount } from '@/lib/discount'
import type { RoomMemberView } from '@/lib/room'
import type { NearMiss } from '@/lib/roomlikes'

type RoomState = {
  room: {
    id: string
    status: 'open' | 'matched'
    matchedAppid: number | null
    isPublic: boolean
    deckRound: number
    deckSize: number | null
  }
  isHost: boolean
  members: RoomMemberView[]
  hasSession: boolean
  isMember: boolean
  matchedGame: {
    appid: number
    name: string
    headerImage: string | null
    art: GameArtUrls | null
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
  discount?: Discount | null
  headerImage: string | null
  art?: GameArtUrls | null
  ccu?: number | null
  tags: string[]
  store?: string
  storeUrl?: string
}

/** Обычный темп опроса и замедленный — когда в комнате давно ничего не двигается */
const POLL_FAST_MS = 2500
const POLL_SLOW_MS = 6000
const POLL_IDLE_AFTER_MS = 60_000

export default function RoomPage() {
  const params = useParams<{ id: string }>()
  const roomId = (params.id ?? '').toUpperCase()

  /**
   * Позвать своих — главное действие комнаты на одного.
   *
   * Логика общая с полем на /compat: на телефоне системная панель
   * «Поделиться», на десктопе буфер, а при отказе буфера — запасной путь
   * через execCommand. Здесь было своё копирование с одним только
   * асинхронным API: в мессенджерном webview он отказывает, и ссылку на пати
   * приходилось выделять руками там, где второй путь сработал бы.
   *
   * Поле со ссылкой в AloneInvite остаётся последним рубежом — теперь оно
   * показывается только когда отказали ОБА пути, а не первый.
   */
  const share = useShareLink(
    () => window.location.href,
    `Пати ${roomId} — imbored`,
    'Выберем игру на вечер вместе',
  )
  const copied = share.state === 'done'
  const copyFailed = share.state === 'manual'
  const copyLink = () => void share.run()

  const [state, setState] = useState<RoomState | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [deckTotal, setDeckTotal] = useState(0)
  const [deckVoted, setDeckVoted] = useState(0)
  const [deckFailed, setDeckFailed] = useState(false)
  const [localVotes, setLocalVotes] = useState(0)
  const [busy, setBusy] = useState(false)
  /** Отказ входа демо-другом. Появился вместе с потолком на /api/connect. */
  const [joinError, setJoinError] = useState<string | null>(null)
  const [likes, setLikes] = useState<{ mine: LikedGame[]; near: NearMiss[] }>({
    mine: [],
    near: [],
  })
  const [hasMore, setHasMore] = useState(false)
  const [pulling, setPulling] = useState(false)
  const deckKey = useRef('')
  const likesKey = useRef('')

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<RoomState | null> => {
      const res = await fetch(`/api/room/${roomId}`, signal ? { signal } : {})
      if (res.status === 404) {
        setNotFound(true)
        return null
      }
      if (!res.ok) return null
      const next = (await res.json()) as RoomState
      setState(next)
      return next
    },
    [roomId],
  )

  /**
   * Опрос состояния комнаты — подписка на внешнюю систему, ровно тот случай,
   * ради которого эффекты и существуют.
   *
   * Четыре вещи, которых тут раньше не было, и каждая стоила денег:
   * опрос не замолкал в фоновой вкладке, продолжался на экране матча (где
   * измениться уже нечему), долбился в 404 вечно и не имел защиты от наложения
   * запросов — на холодной базе ответы приходили не по порядку и счётчики в
   * ростере ехали назад. Замедление после минуты тишины держит живой ростер
   * дешёвым: разница между 2.5 и 6 секундами тут никому не видна.
   */
  useEffect(() => {
    let stopped = false
    let timer = 0
    let inFlight: AbortController | null = null
    let lastChangeAt = Date.now()
    let lastKey = ''

    const arm = () => {
      if (stopped) return
      window.clearTimeout(timer)
      const idle = Date.now() - lastChangeAt > POLL_IDLE_AFTER_MS
      timer = window.setTimeout(() => void tick(), idle ? POLL_SLOW_MS : POLL_FAST_MS)
    }

    const tick = async (force = false) => {
      if (stopped) return
      // В фоне ничего не переспрашиваем: вкладка, забытая на ночь, стоила бы
      // миллионов прочитанных строк и не показала бы никому ни одной.
      //
      // Первый запрос — исключение и делается всегда: ссылку на комнату
      // открывают из чата в фоновой вкладке, и без него человек, переключившись
      // на неё, упирался бы в спиннер вместо готовой страницы. Это ровно один
      // запрос, тот самый, который превращает спиннер в содержимое.
      if ((!force && document.visibilityState !== 'visible') || inFlight) {
        arm()
        return
      }

      const ac = new AbortController()
      inFlight = ac
      try {
        const next = await refresh(ac.signal)
        if (!next) {
          // 404: комнаты нет и не появится
          stopped = true
          return
        }
        const key = `${next.room.status}:${next.room.deckRound}:${next.members
          .map((m) => `${m.id}${m.votes}`)
          .join(',')}`
        if (key !== lastKey) {
          lastKey = key
          lastChangeAt = Date.now()
        }
        if (next.room.status === 'matched') {
          // Церемония терминальна — дальше опрашивать нечего
          stopped = true
          return
        }
      } catch {
        // отменённый запрос или сеть моргнула — просто ждём следующего тика
      } finally {
        if (inFlight === ac) inFlight = null
      }
      arm()
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || stopped) return
      void tick()
    }

    void tick(true)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      inFlight?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const loadDeck = useCallback(async () => {
    setDeckFailed(false)
    try {
      const res = await fetch(`/api/room/${roomId}/deck`)
      if (!res.ok) {
        setDeckFailed(true)
        return
      }
      const data = (await res.json()) as {
        cards: Card[]
        total: number
        votedCount: number
        hasMore: boolean
      }
      // Мержим по appid, а не заменяем: замена выдёргивает карточку из-под
      // пальца, а ownedByAll/missingFor у уже выданных карт после чужого входа
      // становятся ТОЧНЕЕ — их надо обновить, а не выбросить
      setCards((prev) => {
        if (!prev?.length) return data.cards
        const incoming = new Map(data.cards.map((c) => [c.appid, c]))
        const kept = prev.map((c) => incoming.get(c.appid) ?? c)
        const seen = new Set(kept.map((c) => c.appid))
        return [...kept, ...data.cards.filter((c) => !seen.has(c.appid))]
      })
      setDeckTotal(data.total)
      setDeckVoted(data.votedCount)
      setHasMore(data.hasMore)
      setLocalVotes(0)
    } catch {
      setDeckFailed(true)
    } finally {
      setPulling(false)
    }
  }, [roomId])

  /*
   * Ключ, а не флаг «загружено».
   *
   * Колода — функция состава комнаты и раунда: вошёл человек — она пересобрана,
   * подняли раунд — расширена. Прежний boolean-ref означал «загрузили один раз
   * и больше никогда», из-за чего поздний гость оставлял всех остальных со
   * стухшей колодой. Плюс он взводился ДО запроса, и одна ошибка сети запирала
   * участника в вечном спиннере — теперь ключ переписывается только по факту
   * попытки, а deckFailed даёт кнопку «ещё раз».
   */
  const deckWant = state?.isMember
    ? `${state.members.length}:${state.room.deckRound}`
    : ''

  useEffect(() => {
    if (!deckWant || deckKey.current === deckWant || deckFailed) return
    deckKey.current = deckWant
    void loadDeck()
  }, [deckWant, deckFailed, loadDeck])

  async function pullMore() {
    setPulling(true)
    const res = await fetch(`/api/room/${roomId}/round`, { method: 'POST' })
    if (!res.ok) {
      setPulling(false)
      return
    }
    // Раунд поднялся на комнате — свою колоду забираем сразу, остальные
    // подхватят её на ближайшем опросе
    await refresh()
    await loadDeck()
  }

  /*
   * Лайки и почти-совпадения — отдельным разовым запросом, а не частью опроса:
   * перебор голосов плюс метаданные игр каждые 2.5 секунды у каждого участника
   * стоил бы ровно столько же, сколько мы только что убрали из самого опроса.
   *
   * Триггер производный: опрос и так приносит голоса всех, и пока их сумма не
   * сдвинулась, пересчитывать нечего. Пати стоит на месте — запросов ноль.
   */
  const waiting = Boolean(state?.isMember) && cards !== null && cards.length === 0
  const votesKey = state ? state.members.map((m) => `${m.id}${m.votes}`).join(',') : ''

  useEffect(() => {
    if (!waiting || likesKey.current === votesKey) return
    likesKey.current = votesKey
    void (async () => {
      const res = await fetch(`/api/room/${roomId}/likes`)
      if (!res.ok) return
      setLikes((await res.json()) as { mine: LikedGame[]; near: NearMiss[] })
    })()
  }, [waiting, votesKey, roomId])

  async function joinAsDemoFriend() {
    setBusy(true)
    /*
     * Ответ проверяется, а не выбрасывается. Раньше он игнорировался, и это
     * сходило с рук, пока /api/connect не умел отказывать: теперь на нём стоит
     * потолок, и отказ приходит кодом 429. Без проверки сессия не заводилась,
     * следующий join уходил в пустоту, кнопка гасла — и человек не узнавал
     * ничего. Отказ по потолку обязан выглядеть отказом.
     */
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo: true, variant: 2 }),
    })
    if (!res.ok) {
      setJoinError(
        res.status === 429
          ? 'Слишком много попыток подряд. Подожди немного и попробуй снова.'
          : 'Не получилось завести демо-друга. Попробуй ещё раз.',
      )
      setBusy(false)
      return
    }
    setJoinError(null)
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
    setLocalVotes((v) => v + 1)
    const res = await fetch(`/api/room/${roomId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid: card.appid, vote: yes }),
    })
    // Без проверки res.ok любая ошибка давала data.matched === undefined,
    // а undefined !== null истинно — и каждый сбой дёргал лишний опрос
    if (!res.ok) return
    const data = (await res.json()) as { matched: number | null }
    if (data.matched !== null) void refresh()
  }

  async function togglePublic() {
    await fetch(`/api/room/${roomId}/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: !state?.room.isPublic }),
    })
    void refresh()
  }


  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">Такой комнаты нет.</p>
        <Link href="/room/new" className="tap text-ember-text hover:underline text-sm">
          Создать свою →
        </Link>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  // ---- МАТЧ ----
  if (state.room.status === 'matched' && state.matchedGame) {
    return <MatchCeremony game={state.matchedGame} memberCount={state.members.length} />
  }

  // ---- НЕ УЧАСТНИК ----
  if (!state.isMember) {
    return (
      <div className="relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
        <Ambient />
        <div className="relative max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col gap-4 anim-rise">
          <h1 className="font-display text-display-sm">Тебя зовут выбрать игру на вечер</h1>
          <p className="text-dim text-sm">
            Комната <span className="font-mono text-ink">{roomId}</span>. Подключи свою библиотеку —
            и свайпай, во что готов играть. Совпадёте — будет матч.
          </p>
          {state.hasSession ? (
            <button
              onClick={join}
              disabled={busy}
              className="btn-ember is-block py-3"
            >
              Войти в комнату
            </button>
          ) : (
            <>
              <a
                href={`/api/auth/steam?join=${roomId}`}
                className="btn-ember is-block py-3"
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
                className="tap text-sm text-dim hover:text-ink transition-colors"
              >
                {busy ? 'Подключаю…' : 'Демо-друг (без Steam)'}
              </button>
              {joinError && (
                <p role="status" className="anim-rise text-sm text-danger">
                  {joinError}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ---- ЛОББИ + СВАЙП ----
  const card = cards?.[0]
  // Прогресс приходит с сервера (он один знает, сколько карт осталось после
  // фильтра актуальности), но свайп обязан двигать полосу мгновенно, а опрос
  // отстаёт на пару секунд
  const votedCount = deckVoted + localVotes
  const alone = state.members.length <= 1

  return (
    <div className="flex-1 mx-auto w-full max-w-2xl px-5 pt-24 pb-16 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-display-xs">
            Пати <span className="font-mono text-ember-text">{roomId}</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            {alone ? 'Матч нужен минимум вдвоём' : 'Совпадут голоса всех — будет матч'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {state.isHost && (
            <button
              onClick={togglePublic}
              aria-pressed={state.room.isPublic}
              /* py-3, а не py-2: замерено — 38 px при стандарте продукта в 44
                 (докблок .tap). Утилитой .tap не чинится: её зона вылезает на
                 6 px вбок, а соседняя кнопка стоит в 8 — зоны перекрылись бы и
                 воровали друг у друга нажатия. Это единственные два контрола,
                 которыми в пати вообще зовут людей. */
              className={`rounded-[14px] px-4 py-3 text-sm cursor-pointer transition ${
                state.room.isPublic ? 'bg-ember/15 text-ember-text' : 'glass glass-hover text-dim'
              }`}
              title="Открытая комната видна на доске «Пати» — к вам смогут подсесть"
            >
              {state.room.isPublic ? 'На доске ✓' : 'Показать на доске'}
            </button>
          )}
          {/*
            У этой кнопки нет соседнего поля со ссылкой — она стоит в ряду
            действий шапки. Поэтому когда буфер закрыт наглухо, она отсылает к тому,
            что на экране и так есть: код комнаты стоит слева в заголовке, и по нему
            заходят так же, как по ссылке. Молчаливое нажатие читалось бы как
            сломанная кнопка.
          */}
          <button
            onClick={copyLink}
            className="rounded-[14px] glass glass-hover px-4 py-3 text-sm cursor-pointer"
          >
            {copied
              ? 'Скопировано ✓'
              : copyFailed
                ? 'Не вышло — продиктуй код'
                : share.native
                  ? 'Отправить ссылку друзьям'
                  : 'Скопировать ссылку для друзей'}
          </button>
        </div>
      </div>

      {card && (
        <div className="flex flex-wrap gap-2">
          {state.members.map((m) => (
            <span
              key={m.id}
              className={`rounded-full px-3 py-1.5 text-xs ${
                m.me ? 'bg-ember/15 text-ember-text' : 'glass text-dim'
              }`}
            >
              {m.name}
              {m.me ? ' (ты)' : ''} · <span className="font-mono tabular-nums">{m.votes}</span>{' '}
              голосов
            </span>
          ))}
        </div>
      )}

      {deckFailed ? (
        <div className="glass rounded-[20px] p-8 text-center flex flex-col gap-4 anim-rise">
          <p className="font-semibold">Не получилось загрузить игры</p>
          <p className="text-dim text-sm">Скорее всего, это на нашей стороне.</p>
          <button
            onClick={() => void loadDeck()}
            className="btn-ember px-6 py-3 self-center"
          >
            Попробовать ещё раз
          </button>
        </div>
      ) : cards === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : card ? (
        <SwipeDeck
          cards={cards}
          onVote={vote}
          votedCount={votedCount}
          deckTotal={deckTotal}
          alone={state.members.length < 2}
        />
      ) : (
        <RoomWaiting
          roomId={roomId}
          isHost={state.isHost}
          isPublic={state.room.isPublic}
          members={state.members}
          deckSize={state.room.deckSize}
          deckTotal={deckTotal}
          near={likes.near}
          myLikes={likes.mine}
          hasMore={hasMore}
          pulling={pulling}
          onPullMore={pullMore}
          copied={copied}
          copyFailed={copyFailed}
          native={share.native}
          // именно localVotes: колода исчезла из-под пальцев прямо сейчас,
          // а не «когда-то в прошлый заход» — только тогда фокус стоит забирать
          cameFromDeck={localVotes > 0}
          onCopyLink={copyLink}
          onTogglePublic={togglePublic}
        />
      )}
    </div>
  )
}
