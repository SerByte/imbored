'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { NeedSteam } from '@/components/NeedSteam'
import { useShareLink } from '@/components/ShareLink'
import { RoomWaiting } from '@/components/room/RoomWaiting'
import { Spinner } from '@/components/Spinner'
import { SwipeDeck } from '@/components/SwipeDeck'
import type { LikedGame } from '@/components/room/LikesStrips'
import type { GameArtUrls } from '@/lib/art'
import type { Discount } from '@/lib/discount'
import type { RoomMemberView } from '@/lib/room'
import { plural } from '@/lib/plural'
import type { NearMiss } from '@/lib/roomlikes'
import { nextPollStep } from '@/lib/roompoll'
import { isNeedSteam, writerStore } from '@/lib/writer'

/*
 * Церемония матча догружается отдельно.
 *
 * Ядро gsap тут ни при чём: его и так везёт корневой лэйаут через
 * SmoothScroll. Но MatchCeremony тянет за собой SplitHeading с плагином
 * SplitText, а на этой странице ни то ни другое больше не нужно никому.
 * Статический импорт клал этот вес в начальный набор скриптов комнаты — то
 * есть его качал и разбирал КАЖДЫЙ участник пати до первого свайпа, при том
 * что экран матча терминальный: случается один раз на комнату и только если
 * она вообще сошлась.
 *
 * ssr: false ничего не стоит: страница целиком клиентская (опрос каждые 2.5 с),
 * а церемония рисуется только при status === 'matched', то есть заведомо
 * после первого ответа сервера. Заголовок здесь не серверный и не LCP, так
 * что, отдав его клиенту, мы ничем не рискуем.
 */
const MatchCeremony = dynamic(
  () => import('@/components/MatchCeremony').then((m) => m.MatchCeremony),
  { ssr: false },
)

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
/** Пол по частоте для догрузки лайков — см. докблок у эффекта */
const LIKES_MIN_GAP_MS = 12_000

export default function RoomPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
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
  /** Комната на экране устарела: опрос идёт, но ответов нет. */
  const [stale, setStale] = useState(false)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [nowSec, setNowSec] = useState(0)
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
  /**
   * Отказ входа. Появился вместе с потолком на /api/connect ради демо-друга,
   * теперь им же говорит и обычный вход: комнаты нет, сессия истекла, сеть.
   */
  const [joinError, setJoinError] = useState<string | null>(null)
  const [likes, setLikes] = useState<{ mine: LikedGame[]; near: NearMiss[] }>({
    mine: [],
    near: [],
  })
  const [hasMore, setHasMore] = useState(false)
  const [pulling, setPulling] = useState(false)
  /** Добор раунда не удался — кнопка обязана вернуться нажимаемой */
  const [pullFailed, setPullFailed] = useState(false)
  /**
   * Хост вошёл по вставленной ссылке: вывесить комнату на доску ему нельзя
   * (403 needsteam, см. requireWriter в lib/server). Создать такую комнату он
   * уже не может, но созданные раньше живы, и их переключатель молча не
   * срабатывал бы — отсюда строка о входе через Steam.
   */
  const [publicDenied, setPublicDenied] = useState(false)
  const deckKey = useRef('')
  const likesKey = useRef('')
  const likesAt = useRef(0)
  const likesTimer = useRef<number | null>(null)

  /**
   * ОТВЕТ РАЗБИРАЕТСЯ НА ТРИ ИСХОДА, А НЕ НА ДВА.
   *
   * Здесь возвращался `null` и на 404, и на любой другой отказ, а вызывающий
   * трактовал `null` как «комнаты нет и не появится» — комментарий в цикле так
   * и был написан, «404». Одной пятисотки хватало, чтобы опрос замолчал
   * навсегда.
   *
   * Замерено: три опроса за девять секунд, затем один ответ 500 — и НОЛЬ
   * запросов за следующие шестнадцать секунд. Комната застывала на последнем
   * снимке: ростер, голоса, колода — всё на месте и всё враньё, потому что
   * обновляться перестало. На экране при этом ни единого признака.
   *
   * Если же 500 приходил на ПЕРВЫЙ запрос, страница оставалась спиннером
   * навсегда: `state` не появлялся, а цикл уже остановился. Проверено с
   * принудительной пятисоткой в API — четырнадцать секунд спиннера и ни слова
   * о том, что произошло.
   *
   * Обрыв сети, для сравнения, всегда работал правильно: он приходит
   * исключением, попадает в catch и опрос продолжается. Замерено: шесть
   * запросов за те же шестнадцать секунд.
   */
  type Fetched = { ok: true; state: RoomState } | { ok: false; gone: boolean }

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<Fetched> => {
      const res = await fetch(`/api/room/${roomId}`, signal ? { signal } : {})
      if (res.status === 404) {
        setNotFound(true)
        return { ok: false, gone: true }
      }
      if (!res.ok) return { ok: false, gone: false }
      const next = (await res.json()) as RoomState
      setState(next)
      return { ok: true, state: next }
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
    /** Отказов подряд. Сбрасывается первым же успешным ответом. */
    let fails = 0

    /**
     * `slow` — не оптимизация, а вежливость: когда сервер отвечает отказом,
     * долбиться в него каждые 2.5 секунды значит добавлять нагрузки ровно
     * тому, кто уже не справляется.
     */
    const arm = (slow = false) => {
      if (stopped) return
      window.clearTimeout(timer)
      const idle = Date.now() - lastChangeAt > POLL_IDLE_AFTER_MS
      timer = window.setTimeout(() => void tick(), slow || idle ? POLL_SLOW_MS : POLL_FAST_MS)
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
        const got = await refresh(ac.signal)
        // Решение — в lib/roompoll.ts и под тестом. Здесь оно применяется, а
        // не принимается: именно здесь оно однажды и оказалось неверным.
        const step = nextPollStep(
          got.ok ? { ok: true, status: got.state.room.status } : { ok: false, gone: got.gone },
          fails,
        )
        fails = step.fails
        setStale(step.stale)
        if (step.stop) {
          stopped = true
          return
        }
        if (!got.ok) {
          arm(step.slow)
          return
        }
        const next = got.state
        const key = `${next.room.status}:${next.room.deckRound}:${next.members
          .map((m) => `${m.id}${m.votes}`)
          .join(',')}`
        if (key !== lastKey) {
          lastKey = key
          lastChangeAt = Date.now()
        }
      } catch {
        // Оборванная сеть или отменённый запрос. Опрос здесь всегда
        // продолжался и продолжается — замерено шесть запросов за
        // шестнадцать секунд обрыва. Не хватало ровно признака на экране.
        const step = nextPollStep({ ok: false, gone: false }, fails)
        fails = step.fails
        setStale(step.stale)
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
        nowSec: number
      }
      // Часы берём серверные, из того же ответа: по ним подпись онлайна решает,
      // имеет ли право сказать «сейчас». См. докблок в components/PlayersNow.
      setNowSec(data.nowSec)
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
   * Любой обрыв сети — а докблок vote ниже прямо называет лифт и метро
   * обычным делом — отклонял промис в пустоту, и pulling оставался true до
   * перезагрузки страницы. Кнопка при этом disabled={pulling} и подписана
   * «Добираю…», то есть врала, что работа идёт, и одновременно не давала
   * нажать ещё раз. А это единственный способ расшевелить застрявшую пати:
   * раунд общий и приходит всем сразу.
   *
   * refresh тоже внутри try: успешный POST с обрывом на следующем запросе
   * оставлял ровно ту же залипшую кнопку. loadDeck свои отказы ловит сам
   * (deckFailed) и флаг снимает сам, но finally здесь страхует и его.
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
   * Лайки и почти-совпадения — отдельным запросом, а не частью опроса: перебор
   * голосов плюс метаданные игр внутри каждого тика стоили бы ровно столько же,
   * сколько мы из самого опроса убрали.
   *
   * Триггер производный: опрос и так приносит голоса всех, и пока их сумма не
   * сдвинулась, пересчитывать нечего. Пати стоит на месте — запросов ноль.
   *
   * Но это только половина правды, и вторая половина сводила первую на нет.
   * votesKey меняется РОВНО ТОГДА, когда опрос принёс новые голоса, то есть на
   * движущейся пати — каждый тик. А тик это POLL_FAST_MS, те самые 2.5 секунды.
   * Иными словами, ожидающий получал второй опрос той же частоты и с более
   * тяжёлым запросом: roomVotes по всей комнате плюс getGamesMeta. Комната из
   * восьми, где семеро дождались последнего, — это семь таких потоков разом.
   *
   * Замерено на живой комнате, счётчиком поверх window.fetch, при непрерывном
   * голосовании соседа шестьдесят с лишним секунд: 24 запроса к /likes за 63
   * секунды, промежутки — РОВНО 2.5с каждый. С полом на той же нагрузке 7
   * запросов за 78 секунд, промежутки ровно 12.0с. В пересчёте на минуту
   * 22.9 против 5.4, и это на одного ожидающего.
   *
   * Отсюда пол по частоте. Блок «вы близки» — фоновая подсказка, ей не нужна
   * секундная точность; матч приезжает опросом, а не отсюда. Первый заход
   * мгновенный (likesAt нулевой), дальше не чаще чем раз в LIKES_MIN_GAP_MS.
   *
   * Таймер хвостовой, а не гасящий: пропущенные тики схлопываются в один
   * отложенный запрос, и последнее состояние доезжает всегда. Ставится он
   * только если не стоит — иначе каждый тик отодвигал бы срок, и на непрерывно
   * свайпающей пати запрос не ушёл бы вообще ни разу.
   */
  const waiting = Boolean(state?.isMember) && cards !== null && cards.length === 0
  const votesKey = state ? state.members.map((m) => `${m.id}${m.votes}`).join(',') : ''

  useEffect(() => {
    if (!waiting || likesKey.current === votesKey) return
    likesKey.current = votesKey

    const fire = () => {
      likesAt.current = Date.now()
      likesTimer.current = null
      void (async () => {
        const res = await fetch(`/api/room/${roomId}/likes`)
        if (!res.ok) return
        setLikes((await res.json()) as { mine: LikedGame[]; near: NearMiss[] })
      })()
    }

    const left = LIKES_MIN_GAP_MS - (Date.now() - likesAt.current)
    if (left <= 0) {
      fire()
      return
    }
    if (likesTimer.current === null) likesTimer.current = window.setTimeout(fire, left)
  }, [waiting, votesKey, roomId])

  // Снятие таймера — отдельным эффектом с пустыми зависимостями. Верни мы
  // уборку из эффекта выше, она срабатывала бы на КАЖДОЙ смене votesKey и
  // снимала хвост ровно в тот момент, ради которого он и заводится.
  useEffect(
    () => () => {
      if (likesTimer.current !== null) window.clearTimeout(likesTimer.current)
    },
    [],
  )

  /*
   * Ответ на вход — своими словами для каждой причины.
   *
   * Роут входа отвечает 404 (комнаты нет) и 401 (сессия протухла), а клиент
   * res.ok не проверял вовсе: снимал busy и делал refresh, и на экране
   * оставался ровно тот же экран приглашения. Нажатие внешне не делало
   * НИЧЕГО и ни строчки о причине.
   */
  function joinFailure(status: number): string {
    if (status === 404) return 'Такой комнаты уже нет — попроси новую ссылку.'
    if (status === 401) return 'Сессия истекла — подключи библиотеку заново, и вернём тебя сюда.'
    return 'Не получилось войти. Проверь связь и попробуй ещё раз.'
  }

  /*
   * То же, что join, плюс демо-библиотека первым шагом.
   *
   * Ответ /api/connect проверяется, а не выбрасывается. Раньше он
   * игнорировался, и это сходило с рук, пока /api/connect не умел отказывать:
   * теперь на нём стоит потолок, и отказ приходит кодом 429. Без проверки
   * сессия не заводилась, следующий join уходил в пустоту, кнопка гасла — и
   * человек не узнавал ничего. Отказ по потолку обязан выглядеть отказом. Тот
   * же порядок не пускает заявку на вход без библиотеки: иначе участник
   * попадал бы в комнату, из которой ему нечего предложить в колоду.
   *
   * try/finally — по той же причине, что у join ниже: обрыв сети оставлял
   * busy навсегда, и «Демо-друг» застывал на «Подключаю…».
   */
  async function joinAsDemoFriend() {
    if (busy) return
    setBusy(true)
    setJoinError(null)
    try {
      const seed = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo: true, variant: 2 }),
      })
      if (!seed.ok) {
        setJoinError(
          seed.status === 429
            ? 'Слишком много попыток подряд. Подожди немного и попробуй снова.'
            : 'Не получилось завести демо-друга. Попробуй ещё раз.',
        )
        return
      }
      const res = await fetch(`/api/room/${roomId}/join`, { method: 'POST' })
      if (!res.ok) {
        setJoinError(joinFailure(res.status))
        return
      }
      void refresh()
    } catch {
      setJoinError(joinFailure(0))
    } finally {
      setBusy(false)
    }
  }

  /*
   * Вход в комнату по приглашению.
   *
   * Было: setBusy(true), голый await, снятие флага без try. Обрыв сети
   * оставлял busy=true навсегда, а кнопки экрана стоят под disabled={busy} —
   * то есть единственное действие страницы-приглашения умирало от одного
   * моргнувшего вайфая. Отказы роута теперь названы — см. joinFailure.
   */
  async function join() {
    if (busy) return
    setBusy(true)
    setJoinError(null)
    try {
      const res = await fetch(`/api/room/${roomId}/join`, { method: 'POST' })
      if (!res.ok) {
        setJoinError(joinFailure(res.status))
        return
      }
      void refresh()
    } catch {
      setJoinError(joinFailure(0))
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
    const res = await fetch(`/api/room/${roomId}/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: !state?.room.isPublic }),
    }).catch(() => null)
    if (res && (await isNeedSteam(res))) {
      writerStore.set(false)
      setPublicDenied(true)
      return
    }
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

  /*
   * СПИННЕР ЖДЁТ ПЕРВЫЙ ОТВЕТ, А НЕ ВЕЧНОСТЬ.
   *
   * Если первый же запрос отказал, `state` не появится никогда. Замерено с
   * принудительной пятисоткой в API: четырнадцать секунд спиннера и ни слова о
   * том, что произошло. Опрос при этом продолжается — так что экран честно
   * говорит «пробую снова», а не предлагает жать кнопку.
   */
  if (!state) {
    if (stale) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
          <p className="text-lg">Комната не отвечает</p>
          <p className="text-dim text-sm max-w-md leading-relaxed">
            Сервер молчит или связь оборвалась. Пробую снова — если комната жива, она появится
            сама.
          </p>
          <Link href="/rooms" className="tap text-ember-text hover:underline text-sm">
            Ко всем комнатам →
          </Link>
        </div>
      )
    }
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  /*
   * ПЛАШКА УСТАРЕВАНИЯ ЛЕЖИТ В ПОТОКЕ, А НЕ ПОВЕРХ.
   *
   * Первая версия висела `fixed` под шапкой и на снимке накрыла заголовок
   * комнаты и обе кнопки — то есть сообщение о том, что данные врут, само
   * закрыло данные. В потоке столкнуться ей не с чем: контейнер комнаты и так
   * колонка.
   *
   * Последний снимок при этом остаётся на экране целиком: он всё ещё полезен —
   * колода, ростер, кто голосовал. Врал он ровно тем, что выглядел свежим.
   * Плашка это и снимает, ничего не пряча.
   *
   * role="status" с aria-live="polite" — новость приходит без действия
   * человека, и без объявления её не заметит тот, кто не смотрит на экран.
   */
  const staleBadge = stale ? (
    <div
      role="status"
      aria-live="polite"
      className="glass anim-rise rounded-[14px] px-4 py-2.5 text-xs leading-relaxed text-dim"
    >
      Связь потеряна — комната не обновляется. Пробую снова…
    </div>
  ) : null

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
            </>
          )}
          {/*
            Под обеими ветками, а не только под демо-другом: обычный вход тоже
            умеет отказывать, и прежде экран молчал на все его отказы одинаково.
          */}
          {joinError && (
            <p role="status" className="anim-rise text-sm text-danger">
              {joinError}
            </p>
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
  // Ровно то условие, при котором ниже рендерится RoomWaiting с AloneInvite:
  // колода загружена и пуста, а waitingMode отдаёт 'alone'
  const aloneInvite = alone && !deckFailed && cards !== null && !card

  return (
    <div className="flex-1 mx-auto w-full max-w-2xl px-5 pt-24 pb-16 flex flex-col gap-6">
      {staleBadge}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-display-xs">
            Пати <span className="font-mono text-ember-text">{roomId}</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            {alone ? 'Матч нужен минимум вдвоём' : 'Совпадут голоса всех — будет матч'}
          </p>
        </div>
        {/*
          Кнопки прячутся, когда внизу уже стоит AloneInvite.

          Он показывается, когда колода загружена и пуста, а в комнате один
          человек (waitingMode отдаёт 'alone' при memberCount <= 1), и до этой
          правки одинокий хост видел ЧЕТЫРЕ кнопки на ДВА действия: обе пары дёргают одни и те же обработчики.
          Названы они при этом по-разному — копирование «Скопировать ссылку для
          друзей» вверху и «Позвать своих» внизу, публичность «Показать на
          доске» вверху и «Пустить чужих» внизу. Флаг copied к тому же общий, и
          нажатие одной зажигало галочку сразу на обеих: человек своими глазами
          видел, что это один орган управления под двумя именами.

          Прячем ВЕРХНИЕ, а не нижние: AloneInvite ровно для этого случая и
          написан — там развилка «позвать своих или пустить чужих», код комнаты
          героем и запасное поле со ссылкой на случай отказа буфера.

          Пока колода грузится или не загрузилась, AloneInvite нет — и верхние
          кнопки стоят: иначе у одинокого хоста не осталось бы ни одной.
        */}
        <div className={`flex items-center gap-2 flex-wrap ${aloneInvite ? 'hidden' : ''}`}>
          {/*
            Ссылка ПЕРЕД доской, а не после.

            Порядок был обратный: сначала тумблер «показывать на доске», потом
            кнопка «скопировать ссылку». То есть настройка стояла впереди
            действия — притом что подзаголовок этой же страницы говорит «матч
            нужен минимум вдвоём», а /rooms раскладывает порядок по шагам:
            «Создай комнату», потом «Кинь ссылку своим», и только ниже —
            доска открытых пати. Позвать своих — основной путь, доска —
            запасной, и вёрстка обязана читаться так же.
          */}
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
          {state.isHost ? (
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
          ) : state.room.isPublic ? (
            <span
              className="rounded-[14px] bg-ember/15 text-ember-text px-4 py-3 text-sm"
              title="Комната открыта на доске «Пати» — твой ник виден на /rooms"
            >
              На доске
            </span>
          ) : null}
        </div>
      </div>

      {publicDenied && <NeedSteam from={`/room/${roomId}`} className="-mt-3" />}

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
        <>
          <SwipeDeck
            cards={cards}
            onVote={vote}
            votedCount={votedCount}
            deckTotal={deckTotal}
            alone={state.members.length < 2}
            nowSec={nowSec}
          />
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
