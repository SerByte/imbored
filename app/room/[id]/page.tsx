'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { MatchCeremony } from '@/components/MatchCeremony'
import { RoomWaiting } from '@/components/room/RoomWaiting'
import { Spinner } from '@/components/Spinner'
import { useCopy } from '@/components/useCopy'
import { plural } from '@/lib/plural'
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
  const router = useRouter()
  const roomId = (params.id ?? '').toUpperCase()

  const [state, setState] = useState<RoomState | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [deckTotal, setDeckTotal] = useState(0)
  const [deckVoted, setDeckVoted] = useState(0)
  const [deckFailed, setDeckFailed] = useState(false)
  /*
   * Запрос колоды уже в полёте.
   *
   * Один клик «Ещё 20 игр» слал ДВА GET /deck: pullMore зовёт loadDeck явно
   * («свою колоду забираем сразу»), а эффект ниже видит поднятый раунд после
   * refresh и зовёт его же. Оба нужны по отдельности — эффект ловит чужой
   * вход, явный вызов даёт немедленность нажавшему, — поэтому убирать надо не
   * один из них, а дубль: второй заход становится пустышкой.
   */
  const deckInFlight = useRef(false)
  /*
   * Что отсвайпано на этом устройстве и ещё может не доехать до сервера.
   *
   * Слияние в loadDeck добавляет всё, чего нет на руках. Карта, только что
   * убранная свайпом, на руках уже отсутствует — и если ответ /deck собран
   * ДО того, как доехал голос, она возвращается в колоду и человек свайпает
   * её второй раз. Отказавший голос вычёркивает appid обратно: там карта
   * возвращается намеренно, и прятать её нельзя.
   */
  const votedLocally = useRef<Set<number>>(new Set())
  /** Последний голос не доехал: карта возвращена, счётчик отмотан назад. */
  const [voteFailed, setVoteFailed] = useState(false)
  const [localVotes, setLocalVotes] = useState(0)
  const [busy, setBusy] = useState(false)
  /** Вход не удался: сеть моргнула, комнаты нет или сессия протухла */
  const [joinFailed, setJoinFailed] = useState<null | 'net' | 'gone' | 'session'>(null)
  /** Добор раунда не удался — кнопка обязана вернуться нажимаемой */
  const [pullFailed, setPullFailed] = useState(false)
  // Копирование живёт в общем хуке: у него было две реализации, и они уже
  // разошлись — на хабе «Совместимость» отказ буфера не обрабатывался вовсе.
  const { copied, failed: copyFailed, copy } = useCopy()
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
    if (deckInFlight.current) return
    deckInFlight.current = true
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
      // Свои неподтверждённые голоса вычёркиваем из ответа: см. votedLocally
      const пришло = data.cards.filter((c) => !votedLocally.current.has(c.appid))
      setCards((prev) => {
        if (!prev?.length) return пришло
        const incoming = new Map(пришло.map((c) => [c.appid, c]))
        const kept = prev.map((c) => incoming.get(c.appid) ?? c)
        const seen = new Set(kept.map((c) => c.appid))
        return [...kept, ...пришло.filter((c) => !seen.has(c.appid))]
      })
      setDeckTotal(data.total)
      setDeckVoted(data.votedCount)
      setHasMore(data.hasMore)
      setLocalVotes(0)
    } catch {
      setDeckFailed(true)
    } finally {
      deckInFlight.current = false
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

  /*
   * Добор раунда. finally обязателен, и вот чем он оплачен.
   *
   * Было: setPulling(true), голый await fetch и снятие флага только на !res.ok.
   * Любой обрыв сети — а докблок vote десятью строками ниже прямо называет
   * лифт и метро обычным делом — отклонял промис в пустоту, и pulling оставался
   * true до перезагрузки страницы. Кнопка при этом disabled={pulling} и
   * подписана «Добираю…», то есть врала, что работа идёт, и одновременно не
   * давала нажать ещё раз. А это единственный способ расшевелить застрявшую
   * пати: раунд общий и приходит всем сразу.
   *
   * refresh и loadDeck тоже внутри try: успешный POST с обрывом на следующем
   * запросе оставлял ровно ту же залипшую кнопку.
   */
  async function pullMore() {
    if (pulling) return
    setPulling(true)
    setPullFailed(false)
    try {
      const res = await fetch(`/api/room/${roomId}/round`, { method: 'POST' })
      if (!res.ok) throw new Error(`round: HTTP ${res.status}`)
      // Раунд поднялся на комнате — свою колоду забираем сразу, остальные
      // подхватят её на ближайшем опросе
      await refresh()
      await loadDeck()
    } catch {
      setPullFailed(true)
    } finally {
      setPulling(false)
    }
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

  /*
   * То же, что join, плюс демо-библиотека первым шагом.
   *
   * Порядок здесь несущий: провал /api/connect раньше НЕ мешал второму запросу
   * уйти, и заявка на вход отправлялась без библиотеки — участник попадал в
   * комнату, из которой ему нечего предложить в колоду. Теперь второй шаг
   * делается только после успеха первого.
   */
  async function joinAsDemoFriend() {
    if (busy) return
    setBusy(true)
    setJoinFailed(null)
    try {
      const seed = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo: true, variant: 2 }),
      })
      if (!seed.ok) throw new Error(`connect: HTTP ${seed.status}`)
      const res = await fetch(`/api/room/${roomId}/join`, { method: 'POST' })
      if (res.status === 404) return setJoinFailed('gone')
      if (!res.ok) throw new Error(`join: HTTP ${res.status}`)
      void refresh()
    } catch {
      setJoinFailed('net')
    } finally {
      setBusy(false)
    }
  }

  /*
   * Вход в комнату по приглашению.
   *
   * Было: setBusy(true), голый await, снятие флага без try. Обрыв сети оставлял
   * busy=true навсегда, а обе кнопки экрана стоят под disabled={busy} — то есть
   * единственное действие страницы-приглашения умирало от одного моргнувшего
   * вайфая, и «Демо-друг» ещё и застывал на подписи «Подключаю…».
   *
   * res.ok не проверялся вовсе, хотя роут отвечает 404 (комнаты нет) и 401
   * (сессия протухла). В обоих случаях клиент снимал busy и делал refresh, а на
   * экране оставался ровно тот же экран приглашения: нажатие внешне не делало
   * НИЧЕГО и ни строчки о причине. Теперь причина названа своими словами.
   */
  async function join() {
    if (busy) return
    setBusy(true)
    setJoinFailed(null)
    try {
      const res = await fetch(`/api/room/${roomId}/join`, { method: 'POST' })
      if (res.status === 404) return setJoinFailed('gone')
      if (res.status === 401) return setJoinFailed('session')
      if (!res.ok) return setJoinFailed('net')
      void refresh()
    } catch {
      setJoinFailed('net')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Голос за карточку.
   *
   * Оптимистично: карта улетает и счётчик растёт до ответа — иначе свайп
   * ощущается как залипание. Но оптимизм обязан УМЕТЬ ОТКАТЫВАТЬСЯ, и
   * раньше не умел: `if (!res.ok) return` и отсутствие catch съедали и
   * отказ сервера, и обрыв сети молча. Карта при этом уже выброшена, а
   * счётчик увеличен.
   *
   * Цена той тишины считается на троих. У проголосовавшего колода пустеет и
   * экран говорит «все отсвайпали — и ни разу не совпали». У остальных
   * ростер навсегда стоит на 9 из 10, потому что его голоса в базе нет.
   * А сама игра матчем уже не станет никогда: второй раз её никто не
   * увидит. Обрыв связи на телефоне — не исключительная ситуация, это
   * лифт и метро.
   *
   * Поэтому отказ возвращает карту на место и отматывает счётчик, а строка
   * под колодой честно говорит, что голос не ушёл.
   */
  async function vote(card: Card, yes: boolean) {
    setCards((prev) => (prev ? prev.filter((c) => c.appid !== card.appid) : prev))
    votedLocally.current.add(card.appid)
    setLocalVotes((v) => v + 1)
    try {
      const res = await fetch(`/api/room/${roomId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: card.appid, vote: yes }),
      })
      // Проверка res.ok нужна и сама по себе: без неё любая ошибка давала
      // data.matched === undefined, а undefined !== null истинно — и каждый
      // сбой дёргал лишний опрос.
      if (!res.ok) throw new Error(`vote: HTTP ${res.status}`)
      const data = (await res.json()) as { matched: number | null }
      setVoteFailed(false)
      if (data.matched !== null) void refresh()
    } catch {
      // В голову колоды, а не в хвост: карточка возвращается туда, где её
      // только что видели, и повтор — это тот же жест ещё раз.
      setCards((prev) => (prev ? [card, ...prev.filter((c) => c.appid !== card.appid)] : prev))
      // Карта вернулась намеренно — прятать её от следующего /deck нельзя
      votedLocally.current.delete(card.appid)
      setLocalVotes((v) => Math.max(0, v - 1))
      setVoteFailed(true)
    }
  }

  /**
   * Убрать участника — или уйти самому, если memberId не назван.
   *
   * Знаменатель единогласия это число участников (findRoomMatch), а DELETE
   * из room_members до сих пор не существовало нигде. Один вошедший и
   * закрывший вкладку запирал комнату навсегда, и остальные вечно читали
   * «сошлись на N играх, ждём третьего». Сам он кнопку уже не нажмёт —
   * поэтому рука хоста тут не украшение, а единственный выход.
   *
   * Наружу уходит ХЕШ участника, не steamid: см. шапку lib/room.ts.
   */
  async function removeMember(memberId?: string) {
    const res = await fetch(`/api/room/${roomId}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memberId ? { memberId } : {}),
    }).catch(() => null)
    if (!res?.ok) return
    // Ушёл сам — на доску, там есть куда подсесть. Убрал другого — остаёмся
    // и перечитываем: матч мог стать достижим прямо этим действием.
    if (memberId) void refresh()
    else router.push('/rooms')
  }

  async function togglePublic() {
    await fetch(`/api/room/${roomId}/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: !state?.room.isPublic }),
    })
    void refresh()
  }

  const copyLink = () => void copy(window.location.href)

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">Такой комнаты нет.</p>
        <Link href="/room/new" className="text-ember-text hover:underline text-sm">
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
          <h1 className="text-2xl font-bold tracking-tight">Тебя зовут выбрать игру на вечер</h1>
          <p className="text-dim text-sm">
            Комната <span className="font-mono text-ink">{roomId}</span>. Подключи свою библиотеку —
            и свайпай, во что готов играть. Совпадёте — будет матч.
          </p>
          {state.hasSession ? (
            <button
              onClick={join}
              disabled={busy}
              className="btn-fill rounded-[14px] font-semibold py-3"
            >
              Войти в комнату
            </button>
          ) : (
            <>
              <a
                href={`/api/auth/steam?join=${roomId}`}
                className="rounded-[14px] bg-ember text-on-ember font-semibold py-3 hover:brightness-110 transition"
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
          {/*
            Причина названа своими словами, и у каждой свой следующий шаг.
            Прежде экран молчал на все три случая одинаково: нажатие внешне не
            делало ничего.
          */}
          {joinFailed ? (
            <p role="status" className="text-sm text-danger">
              {joinFailed === 'gone'
                ? 'Такой комнаты уже нет — попроси новую ссылку.'
                : joinFailed === 'session'
                  ? 'Сессия истекла — подключи библиотеку заново, и вернём тебя сюда.'
                  : 'Не получилось войти. Проверь связь и попробуй ещё раз.'}
            </p>
          ) : null}
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
          <h1 className="text-xl font-bold tracking-tight">
            Пати <span className="font-mono text-ember-text">{roomId}</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            {alone ? 'Матч нужен минимум вдвоём' : 'Совпадут голоса всех — будет матч'}
          </p>
        </div>
        {/*
          Кнопки прячутся, когда внизу уже стоит AloneInvite.

          Он показывается ровно при alone && !card (waitingMode отдаёт 'alone'
          при memberCount <= 1), и до этой правки одинокий хост видел ЧЕТЫРЕ
          кнопки на ДВА действия: обе пары дёргают одни и те же обработчики.
          Названы они при этом по-разному — копирование «Скопировать ссылку для
          друзей» вверху и «Позвать своих» внизу, публичность «Показать на
          доске» вверху и «Пустить чужих» внизу. Флаг copied к тому же общий, и
          нажатие одной зажигало галочку сразу на обеих: человек своими глазами
          видел, что это один орган управления под двумя именами.

          Прячем ВЕРХНИЕ, а не нижние: AloneInvite ровно для этого случая и
          написан — там развилка «позвать своих или пустить чужих», код комнаты
          героем и запасное поле со ссылкой на случай отказа буфера.
        */}
        <div className={`flex items-center gap-2 flex-wrap ${alone && !card ? 'hidden' : ''}`}>
          {/*
            Индикатор отделён от переключателя.

            Раньше всё это было под state.isHost, то есть гость не знал, что
            комната открыта на доске и его ник виден на /rooms. Сервер отдаёт
            isPublic всем (app/api/room/[id]/route.ts) — скрыта была только
            отрисовка. Хост включает публичность в любой момент, в том числе
            уже после того, как гость вошёл.

            Управление остаётся хосту: снять комнату с доски может только он
            (роут отвечает nothost остальным), и кнопка, отвечающая отказом,
            хуже её отсутствия.
          */}
          {/*
            Ссылка ПЕРЕД доской, а не после.

            Порядок был обратный: сначала тумблер «показывать на доске», потом
            кнопка «скопировать ссылку». То есть настройка стояла впереди
            действия — притом что подзаголовок этой же страницы говорит «матч
            нужен минимум вдвоём», а /rooms формулирует порядок прямым текстом:
            «собери свою комнату и скинь ссылку друзьям — ИЛИ подсядь к
            открытой». Позвать своих — основной путь, доска — запасной, и
            вёрстка обязана читаться так же.
          */}
          {/*
            Отказ буфера виден и здесь, а не только в AloneInvite.

            Страница брала из useCopy оба состояния, но в эту кнопку пробрасывала
            только copied: failed уходил вниз, в RoomWaiting, который рендерится
            ТОЛЬКО когда колода уже пуста. Пока карточки есть — то есть всё время
            свайпа, — отказ буфера не давал вообще ничего: ни галочки, ни строки,
            ни запасного поля. Человек жал снова и снова, а ссылка, ради которой
            всё, в руки не попадала.

            Случаи отказа перечислены в докблоке самого хука: небезопасный
            origin, отказ в разрешении, часть мобильных браузеров.

            Запасной ход тут короче, чем в AloneInvite с его полем: copyLink
            копирует window.location.href, то есть адрес ЭТОЙ ЖЕ страницы — он и
            так на виду.
          */}
          <button
            onClick={copyLink}
            className="rounded-[14px] glass glass-hover px-4 py-2 text-sm cursor-pointer"
          >
            {copied
              ? 'Скопировано ✓'
              : copyFailed
                ? 'Не вышло — ссылка в адресной строке'
                : 'Скопировать ссылку для друзей'}
          </button>
          {state.isHost ? (
            <button
              onClick={togglePublic}
              aria-pressed={state.room.isPublic}
              className={`rounded-[14px] px-4 py-2 text-sm cursor-pointer transition ${
                state.room.isPublic ? 'bg-ember/15 text-ember-text' : 'glass glass-hover text-dim'
              }`}
              title="Открытая комната видна на доске «Пати» — к вам смогут подсесть"
            >
              {state.room.isPublic ? 'На доске ✓' : 'Показать на доске'}
            </button>
          ) : state.room.isPublic ? (
            <span
              className="rounded-[14px] bg-ember/15 text-ember-text px-4 py-2 text-sm"
              title="Комната открыта на доске «Пати» — твой ник виден на /rooms"
            >
              На доске
            </span>
          ) : null}
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
              {/* было прибито строкой: «1 голосов», «2 голосов» */}
              {plural(m.votes, 'голос', 'голоса', 'голосов')}
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
            className="rounded-[14px] bg-ember text-on-ember font-semibold px-6 py-3 hover:brightness-110 transition cursor-pointer self-center"
          >
            Попробовать ещё раз
          </button>
        </div>
      ) : cards === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : card ? (
        <>
          <SwipeDeck cards={cards} onVote={vote} votedCount={votedCount} deckTotal={deckTotal} />
          {voteFailed ? (
            <p role="status" className="mt-3 text-center text-sm text-danger">
              Голос не ушёл — карточка вернулась, свайпни ещё раз.
            </p>
          ) : null}
        </>
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
          onRemoveMember={(memberId) => void removeMember(memberId)}
          onLeave={() => void removeMember()}
          hasMore={hasMore}
          pulling={pulling}
          pullFailed={pullFailed}
          onPullMore={pullMore}
          copied={copied}
          copyFailed={copyFailed}
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
