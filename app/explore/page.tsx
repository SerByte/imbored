'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { GameCardBody } from '@/components/GameCard'
import { TilePending } from '@/components/TilePending'
import { Icon } from '@/components/Icon'
import { SectionLabel } from '@/components/Labels'
import { NeedSteam } from '@/components/NeedSteam'
import { DiscountCorner, PriceTag } from '@/components/PriceTag'
import { PrivacyHelp } from '@/components/PrivacyHelp'
import { StatusLine } from '@/components/StatusLine'
import { SwipeDeck, type DeckCard, type DeckLabels } from '@/components/SwipeDeck'
import { WarmupScreen } from '@/components/WarmupScreen'
import type { ExploreCard, ShelfCard } from '@/lib/cards'
import { bounceTo, reconnectHref, steamLoginFor } from '@/lib/destination'
import {
  EXPLORE_REASON,
  EXPLORE_SHELF_FOLD,
  EXPLORE_SHELF_MAX,
  exploreSignal,
  putBack,
} from '@/lib/explore'
import { focusAdrift } from '@/lib/focushandoff'
import { remainingLine, runWarmup, type WarmupProgress } from '@/lib/warmup'
import { isNeedSteam, writerStore } from '@/lib/writer'

/**
 * ПОЧЕМУ КОЛОДА НЕ СОБРАЛАСЬ — РАЗНЫМИ СЛОВАМИ.
 *
 * Тот же разбор, что у /play и /daily (сторож lib/failscreens.test.ts): под
 * 409 живут «нет снимка библиотеки» и «листать нечего», и советы у них
 * противоположные. Код читается из тела ответа.
 */
const FAIL: Record<string, { title: string; text: string }> = {
  nolibrary: {
    title: 'Библиотека не доехала',
    text: 'Steam не отдал список игр. Чаще всего его прячут настройки профиля — и это чинится за минуту.',
  },
  nocandidates: {
    title: 'Листать пока нечего',
    text: 'Всё, что подошло бы, ты уже пролистал или убрал в бан. Пролистанное вернётся через неделю — а пока можно подобрать игру под настроение.',
  },
  ratelimited: {
    title: 'Слишком часто',
    text: 'Колода собирается из всей библиотеки, и на это стоит потолок. Вернись через несколько минут.',
  },
}

/**
 * Сеть, пятисотка, оборванный ответ, потолок ожидания (EXPLORE_WAIT_MS).
 * Единственный отказ, у которого есть «Попробовать снова»: у остальных
 * повтор вернёт тот же 409 или 429 (lib/failscreens.test.ts).
 */
const FAIL_UNKNOWN = {
  title: 'Не получилось собрать колоду',
  text: 'Похоже, что-то сломалось по дороге — попробуй ещё раз.',
}

/**
 * «Интересно» и «Мимо», а не «Играем!» и «Не хочу»: в колоде исследователя
 * никто ничего не обещает — это и есть «без обязательств».
 */
const LABELS: DeckLabels = { yes: 'Интересно', no: 'Мимо' }

/**
 * Плитка полки из карты колоды — приглянувшееся только что, ещё до сервера.
 * Цена — по тем же правилам, что у shelfCardView: у своей игры её нет.
 */
function shelfOf(card: DeckCard): ShelfCard {
  const owned = card.ownedByAll
  const isFree = !owned && card.isFree === true
  return {
    appid: card.appid,
    name: card.name,
    headerImage: card.headerImage,
    art: card.art ?? null,
    owned,
    isFree,
    priceFinal: owned || isFree ? null : (card.priceFinal ?? null),
    priceCc: owned ? null : (card.priceCc ?? null),
    // и у бесплатной: «не продаётся» PriceTag ставит раньше «бесплатно»
    unsold: !owned && card.unsold === true,
    discount: owned ? null : (card.discount ?? null),
  }
}

export default function ExplorePage() {
  const router = useRouter()
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  /** Код отказа из тела ответа: nolibrary, nocandidates, ratelimited или null. */
  const [reason, setReason] = useState<string | null>(null)
  const [prep, setPrep] = useState<WarmupProgress | null>(null)
  const [message, setMessage] = useState('Изучаю твою библиотеку…')
  const [cards, setCards] = useState<ExploreCard[]>([])
  const [deckTotal, setDeckTotal] = useState(0)
  const [voted, setVoted] = useState(0)
  const [liked, setLiked] = useState<ShelfCard[]>([])
  /** Полка развёрнута целиком — до этого видно EXPLORE_SHELF_FOLD плиток */
  const [shelfOpen, setShelfOpen] = useState(false)
  /** Какую плитку не удалось убрать — строка под ней */
  const [unlikeMiss, setUnlikeMiss] = useState<number | null>(null)
  /**
   * Фокус после ухода плитки: соседняя кнопка «Убрать» или строка «полка
   * пуста». 'end' — заголовок «Колода кончилась» после голоса с клавиатуры,
   * 'deck' — «Мимо» карты, которую вернули с клавиатуры (undo).
   */
  const pendingFocus = useRef<number | 'empty' | 'end' | 'deck' | null>(null)
  const unlikeButtons = useRef(new Map<number, HTMLButtonElement>())
  const shelfEmpty = useRef<HTMLParagraphElement>(null)
  /** Панель «Колода кончилась» и её заголовок — см. vote и redeal */
  const deckEnd = useRef<HTMLDivElement>(null)
  const deckEndHead = useRef<HTMLHeadingElement>(null)
  /**
   * Убранное на этой странице. Ответ «Ещё колоду» мог прочитать полку до
   * того, как «Мимо» доехало до базы (а у сессии только для чтения полка и
   * вовсе на устройстве), — без этого списка mergeShelf вернул бы убранное.
   */
  const removed = useRef(new Set<number>())
  /** С полки уже убирали — пустая полка тогда говорит об этом, а не исчезает */
  const [shelfTouched, setShelfTouched] = useState(false)
  const [nowSec, setNowSec] = useState(0)
  /** «Ещё колоду» едет — кнопка ждёт ответа */
  const [dealing, setDealing] = useState(false)
  /** «Попробовать снова» на экране отказа едет — см. retry */
  const [retrying, setRetrying] = useState(false)
  /** Запрос «Ещё колоду» или повтора с экрана отказа: уход со страницы его отменяет */
  const redealing = useRef<AbortController | null>(null)
  /** Экран отказа и его заголовок — см. эффект фокуса и retry */
  const failBox = useRef<HTMLDivElement>(null)
  const failHead = useRef<HTMLHeadingElement>(null)
  /**
   * Почему «Ещё колоду» не собралась — строкой под кнопкой, а не экраном
   * отказа: полка «Приглянулось» на экране, и отнимать её из-за потолка
   * частоты незачем. null — сказать нечего.
   */
  const [redealMiss, setRedealMiss] = useState<string | null>(null)
  /**
   * Новая колода забирает фокус на «Интересно» первой карты (initialFocus у
   * SwipeDeck): «Ещё колоду» нажали с клавиатуры, и фокус так и остался в
   * уходящей панели — или потерян. Решается, когда ответ уже пришёл, а не при
   * нажатии: за время запроса человек мог уйти на полку, и отнимать у него
   * это место незачем (lib/focushandoff).
   */
  const [dealFocus, setDealFocus] = useState(false)
  /**
   * За какие карты голос уже отдан. Улетающая карта ещё 220 мс живёт в DOM, и
   * второй Enter по ней отправил бы второй свайп той же игры (см. TopCard).
   */
  const votedIds = useRef(new Set<number>())
  /**
   * Последнее «Мимо» — под колодой кнопка «Вернуть «X»» (undo). Одно, а не
   * стопка: отмена — про промах пальцем секунду назад, а не листание назад.
   */
  const [lastSkip, setLastSkip] = useState<ExploreCard | null>(null)
  /**
   * Вернули карту — колода встаёт заново (key у SwipeDeck): вернувшаяся
   * въезжает наверх своей анимацией появления, а не из-под улетающей соседки.
   */
  const [undone, setUndone] = useState(0)
  /** Что сказать скринридеру о вернувшейся карте — строка стоит с первого кадра колоды */
  const [said, setSaid] = useState('')
  /**
   * Сессия только читает (lib/writer): колода листается и у неё, но на
   * устройстве — «Приглянулось» живёт до закрытия вкладки. Строка NeedSteam
   * говорит, почему и как это исправить.
   */
  const readOnly =
    useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server) === false

  /**
   * Ответ /api/explore — на экран. 401 — на вход; прочий отказ — в экран
   * отказа, а у «Ещё колоду» (onMiss) — строкой под кнопкой.
   *
   * 'gone' — страница уже уезжает на вход, и возвращать на экран вызывающему
   * нечего (см. retry). Иначе null.
   */
  const show = useCallback(
    async (
      res: Response,
      signal: AbortSignal,
      onMiss?: (code: string | null) => void,
    ): Promise<'gone' | null> => {
      if (!res.ok) {
        const code = await res
          .json()
          .then((d: { error?: unknown }) => (typeof d.error === 'string' ? d.error : null))
          .catch(() => null)
        // replace, а не push: запись /explore без сессии мертва, и «Назад» с
        // лендинга снова открывал её — 401 — и снова уводил на лендинг. Дальше
        // /explore назад было не уйти, к квизу или чужому пику тоже
        if (res.status === 401) {
          if (!signal.aborted) router.replace(bounceTo('/explore'))
          return 'gone'
        }
        if (onMiss) {
          onMiss(code)
          return null
        }
        setReason(code)
        setPhase('error')
        return null
      }
      setRedealMiss(null)
      const data = (await res.json()) as { cards: ExploreCard[]; liked: ShelfCard[]; nowSec: number }
      votedIds.current = new Set()
      // «Мимо» прежней колоды назад не вернуть: её уже нет на экране
      setLastSkip(null)
      setNowSec(data.nowSec)
      setCards(data.cards)
      setDeckTotal(data.cards.length)
      setVoted(0)
      // Приглянувшееся на этом устройстве (сессия только читает) не теряется
      // с новой колодой: сервер его не знает, но человек его видел
      setLiked((local) => mergeShelf(local, data.liked.filter((c) => !removed.current.has(c.appid))))
      setReason(null)
      setPhase('ok')
      return null
    },
    [router],
  )

  useEffect(() => {
    /*
     * Прогрев тот же, что у /play, и с тем же onYield: колоде хватает первого
     * круга, а догрев идёт под ней. Уход со страницы останавливает и прогрев,
     * и запрос — отмена в cleanup, а не флаг «уже запущено».
     */
    const ac = new AbortController()
    const { signal } = ac
    const deal = async () => {
      setMessage('Собираю колоду…')
      try {
        await show(await fetch('/api/explore', { signal: exploreSignal(signal) }), signal)
      } catch {
        // Потолок обрывает запрос, но не страницу: signal цел, и это отказ
        if (!signal.aborted) setPhase('error')
      }
    }
    void (async () => {
      let first: Promise<void> | null = null
      const warm = await runWarmup({
        signal,
        onProgress: (p) => {
          setPrep(p)
          if (p.remaining > 0) setMessage(remainingLine(p.remaining))
        },
        onYield: () => {
          first = deal()
        },
      })
      if (warm === 'aborted') return
      if (warm === 'unauthorized') {
        // replace — по той же причине, что в show
        if (!first) router.replace(bounceTo('/explore'))
        return
      }
      if (warm === 'error' && !first) {
        setPhase('error')
        return
      }
      await (first ?? deal())
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => redealing.current?.abort(), [])

  /**
   * «Ещё колоду» — без прогрева: каталог уже разобран первым заходом.
   * keyboard — нажата с клавиатуры или скринридером (см. dealFocus).
   */
  const redeal = async (keyboard: boolean) => {
    if (dealing) return
    // Прежний отказ гаснет до запроса: второй 429 подряд — тот же текст, и
    // строка под кнопкой промолчала бы (REPEAT в lib/liveregion.test.ts)
    setRedealMiss(null)
    const ac = new AbortController()
    redealing.current = ac
    setDealing(true)
    const miss = (code: string | null) => setRedealMiss((FAIL[code ?? ''] ?? FAIL_UNKNOWN).text)
    try {
      const res = await fetch('/api/explore', { signal: exploreSignal(ac.signal) })
      setDealFocus(keyboard && focusAdrift(document, deckEnd.current))
      await show(res, ac.signal, miss)
    } catch {
      // Решает сигнал страницы, а не запроса: обрыв по потолку — отказ, и
      // кнопка возвращается, а не стоит в «Собираю…» до перезагрузки
      if (!ac.signal.aborted) miss(null)
    } finally {
      if (!ac.signal.aborted) setDealing(false)
    }
  }

  /**
   * «Попробовать снова» на экране отказа — только у FAIL_UNKNOWN. Тот же
   * запрос, что у «Ещё колоду», и тоже без прогрева: колода собирается из
   * того каталога, что уже есть.
   *
   * Неудача оставляет экран как есть, как у /play: кнопка на aria-disabled
   * держит фокус, а строка статуса гаснет на время попытки (retrying) и
   * возвращается — повтор того же отказа звучит. Отказ с другой причиной
   * уносит кнопку (у потолка частоты повтора нет), и фокус забирает
   * заголовок экрана (эффект ниже). Удача — как у «Ещё колоду»: нажатая с
   * клавиатуры кнопка уходит вместе с экраном, и фокус берёт «Интересно»
   * первой карты.
   *
   * Сессия кончилась, пока экран стоял (401, show отдаёт 'gone'), — экран так
   * и остаётся в «Пробую…» до ухода. Сигнал страницы в этот миг ещё цел:
   * router.replace только запущен, — и без этой проверки строка статуса
   * получила бы текст обратно и объявила отказ, которого нет, под уже
   * начатый уход на вход, а эффект фокуса унёс бы потерянный фокус на
   * заголовок отказа. Та же сделка, что у промаха 'gone' на /play: ни
   * голоса, ни экрана отказа.
   */
  const retry = async (keyboard: boolean) => {
    if (retrying) return
    const ac = new AbortController()
    redealing.current = ac
    setRetrying(true)
    let gone = false
    try {
      const res = await fetch('/api/explore', { signal: exploreSignal(ac.signal) })
      setDealFocus(keyboard && focusAdrift(document, failBox.current))
      gone = (await show(res, ac.signal)) === 'gone'
    } catch {
      if (!ac.signal.aborted) setReason(null)
    } finally {
      if (!ac.signal.aborted && !gone) setRetrying(false)
    }
  }

  /**
   * Свайп. Экран меняется сразу, сервер узнаёт следом: «Интересно» — это
   * 'opened' (слабый сигнал вкуса, как открытая карточка), «Мимо» — 'skipped',
   * оба с причиной explore. Отправка без ожидания, как учебные сигналы /play:
   * потерянный свайп не беда. Сессии только для чтения сервер ответит
   * needsteam — тогда страница перестаёт слать и листает на устройстве.
   */
  const vote = (card: DeckCard, yes: boolean, keyboard: boolean) => {
    if (votedIds.current.has(card.appid)) return
    votedIds.current.add(card.appid)
    // Вернуть можно только последнее «Мимо»: следующий голос — уже решение
    // дальше, и кнопка уходит вместе с ним. «Интересно» своей отмены здесь
    // не ждёт — его забирает «Убрать» на полке
    setLastSkip(yes ? null : (cards.find((c) => c.appid === card.appid) ?? null))
    // Та же карта, вернутая второй раз, — тот же текст: без сброса строка промолчала бы
    setSaid('')
    // Последняя карта уносит колоду целиком — вместе с кнопкой в фокусе и
    // живой областью, — и фокус падал в body. Голос с клавиатуры забирает
    // заголовок панели, вставшей на её место: он же и объявит, что случилось
    if (keyboard && cards.length === 1) pendingFocus.current = 'end'
    setCards((cs) => cs.filter((c) => c.appid !== card.appid))
    setVoted((v) => v + 1)
    if (yes) {
      removed.current.delete(card.appid)
      setLiked((l) => mergeShelf([shelfOf(card)], l))
    }
    if (writerStore.get() === false) return
    void fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appid: card.appid,
        action: yes ? 'opened' : 'skipped',
        reason: EXPLORE_REASON,
      }),
    })
      .then(async (r) => {
        if (await isNeedSteam(r)) writerStore.set(false)
      })
      .catch(() => {})
  }

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    const el =
      target === 'empty'
        ? shelfEmpty.current
        : target === 'end'
          ? deckEndHead.current
          : target === 'deck'
            ? document.querySelector<HTMLElement>('.deck-stack button')
            : unlikeButtons.current.get(target)
    el?.focus()
  })

  /**
   * «Вернуть «X»» — последнее «Мимо» назад, наверх колоды, тем же номером.
   *
   * «Мимо» в колоде исследователя уводит карту из колоды на неделю
   * (EXPLORE_PASS_SEC в lib/explore), и промах пальцем по соседней кнопке
   * забирал её без обратного хода. Сервер отмену не пишет: listExplore и listExploreLiked
   * читают ПОСЛЕДНИЙ свайп игры, так что новый голос по вернувшейся карте
   * сам перекрывает «Мимо» — «Интересно» кладёт её на полку, как обычно.
   * Вернули и не голосовали — строка «Мимо» остаётся, и в следующую колоду
   * карта не придёт неделю. Это честно: её видели и пролистали, а пока
   * вкладка открыта, она лежит наверху колоды. Вкус «Мимо» не трогает
   * вовсе (listFeedback его не читает), так что отменять на сервере нечего.
   *
   * Без таймера: кнопка живёт до следующего голоса или новой колоды. Гаснущая
   * через восемь секунд отмена не дождалась бы того, кто идёт к ней Tab'ом
   * или скринридером (WCAG 2.2.1).
   *
   * С клавиатуры фокус встаёт на «Мимо» вернувшейся карты — туда, где он был
   * до промаха: нажатая кнопка уходит, и без этого фокус упал бы в body.
   */
  const undo = (keyboard: boolean) => {
    const card = lastSkip
    if (!card) return
    votedIds.current.delete(card.appid)
    setLastSkip(null)
    setCards((cs) => [card, ...cs])
    setVoted((v) => v - 1)
    setUndone((n) => n + 1)
    // Колода встаёт заново, но это не «новая колода»: фокус ей отдаёт undo, а не redeal
    setDealFocus(false)
    setSaid(`«${card.name}» снова в колоде`)
    if (keyboard) pendingFocus.current = 'deck'
  }

  /**
   * Экран отказа встал — на место прогрева или после повтора, унёсшего свою
   * кнопку. Фокус, оказавшийся в body, забирает заголовок экрана: следующий
   * Tab ведёт к его кнопке, а не в начало шапки. Человек стоит где-то сам —
   * фокус остаётся при нём (lib/focushandoff), об отказе скажет строка
   * статуса. Неудачный повтор той же причины фокус не трогает: кнопка на
   * aria-disabled его удержала.
   */
  useEffect(() => {
    if (phase !== 'error' || retrying) return
    if (focusAdrift(document)) failHead.current?.focus()
  }, [phase, reason, retrying])

  /**
   * «Убрать» с полки — тот же свайп «Мимо», только запоздалый: listExploreLiked
   * смотрит на последний свайп, и он снимает игру с полки. Плитка уходит
   * сразу; отказ сервера возвращает только её (putBack в lib/explore): за
   * время запроса полка могла измениться, и снимок стёр бы чужие перемены.
   * Сессия только для чтения держит полку на устройстве — ей убирать можно
   * без сервера.
   */
  const unlike = async (card: ShelfCard) => {
    const before = liked
    const at = liked.findIndex((c) => c.appid === card.appid)
    const neighbour = liked[at + 1] ?? liked[at - 1]
    setUnlikeMiss(null)
    setShelfTouched(true)
    removed.current.add(card.appid)
    pendingFocus.current = neighbour ? neighbour.appid : 'empty'
    setLiked((l) => l.filter((c) => c.appid !== card.appid))
    if (writerStore.get() === false) return
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: card.appid, action: 'skipped', reason: EXPLORE_REASON }),
      })
      if (await isNeedSteam(res)) {
        // Права кончились, пока страница была открыта: полка дальше живёт на
        // устройстве, и убранное остаётся убранным
        writerStore.set(false)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      removed.current.delete(card.appid)
      pendingFocus.current = card.appid
      setLiked((l) => putBack(l, card, before))
      setUnlikeMiss(card.appid)
    }
  }

  const fail = FAIL[reason ?? ''] ?? FAIL_UNKNOWN

  /*
   * Строка статуса страницы — первым ребёнком фрагмента в каждом return.
   *
   * Отказ подменяет экран целиком: WarmupScreen уходит вместе со своей живой
   * строкой прогресса, и «Библиотека не доехала» вставала молча — ни одна
   * область в DOM не меняла текст. Эта стоит с первого кадра, пустая, и
   * переживает подмену, потому что React сверяет детей по месту (сторож —
   * lib/liveregion.test.ts). На время повтора она гаснет: тот же отказ
   * второй раз подряд — тот же текст, и без паузы область промолчала бы.
   */
  const status = (
    <StatusLine text={phase === 'error' && !retrying ? `${fail.title}. ${fail.text}` : null} className="sr-only" />
  )

  if (phase === 'loading') {
    return (
      <>
        {status}
        <WarmupScreen progress={prep} message={message} />
      </>
    )
  }

  if (phase === 'error') {
    return (
      <>
        {status}
        <div ref={failBox} className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
          {/* Заголовок экрана, а не абзац: на него переезжает потерянный фокус
              (эффект выше). Голос — у строки статуса, роли здесь нет. Кольцо
              не снимается, как у «Колода кончилась»: оно показывает, куда
              встал фокус (да и outline-none общее :focus-visible перебивает) */}
          <h1 ref={failHead} tabIndex={-1} className="text-lg">
            {fail.title}
          </h1>
          <p className="text-dim text-sm max-w-md leading-relaxed">{fail.text}</p>
          {/* Проверка — входом через Steam, как на /play: снимок пишет вход. */}
          {reason === 'nolibrary' && (
            <div className="max-w-md text-left">
              <PrivacyHelp retryHref={readOnly ? undefined : steamLoginFor('/explore')} />
            </div>
          )}
          {/* aria-disabled, а не disabled: неудача повтора оставляет экран как
              есть, и фокус обязан остаться на кнопке. Повтор гасит сам retry */}
          {fail === FAIL_UNKNOWN && (
            <button
              type="button"
              onClick={(e) => void retry(e.detail === 0)}
              aria-disabled={retrying}
              className="tap cursor-pointer text-sm text-ember-text hover:underline aria-disabled:opacity-50"
            >
              {retrying ? 'Пробую…' : 'Попробовать снова'}
            </button>
          )}
          {reason === 'nolibrary' ? (
            <Link href={reconnectHref()} className="btn-ember px-6 py-3">
              Подключить заново
            </Link>
          ) : (
            <Link href="/quiz" className="tap link-more">
              Подобрать под настроение
              <Icon name="arrow" size={16} />
            </Link>
          )}
        </div>
      </>
    )
  }

  const top = cards[0]
  // Откат уже вернул плитку на полку — название берётся оттуда
  const unlikeMissName = unlikeMiss === null ? undefined : liked.find((c) => c.appid === unlikeMiss)?.name

  return (
    <>
    {status}
    {/*
      Две колонки с md: колода слева, заголовок и полка «Приглянулось»
      справа — постер 2:3 во всю ширину прежней колонки был бы выше окна.
      Порядок в разметке прежний (заголовок, колода, полка): на телефоне
      колонка одна, и скринридер читает то же, что видит глаз.
    */}
    <div className="flex-1 mx-auto w-full max-w-6xl px-safe pt-28 pb-16 grid gap-8 md:grid-cols-[minmax(0,440px)_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:gap-x-14">
      <div className="flex flex-col gap-2 md:col-start-2 md:row-start-1 md:pt-4">
        <h1 className="font-display text-display-sm">Полистать без обязательств</h1>
        <p className="text-sm text-dim leading-relaxed">
          Своё и из магазина вперемешку, без вопросов о настроении. «Мимо» ничего не
          прячет и не портит подбор — а «Интересно» кладёт игру на полку ниже.
        </p>
        {readOnly && (
          <p className="text-sm text-dim">
            Листать можно и так, но полка запомнится только до закрытия вкладки.
          </p>
        )}
        {readOnly && <NeedSteam from="/explore" />}
      </div>

      <div className="md:col-start-1 md:row-start-1 md:row-span-2">
      {top ? (
        <SwipeDeck
          key={undone}
          cards={cards}
          onVote={vote}
          votedCount={voted}
          deckTotal={deckTotal}
          alone
          labels={LABELS}
          nowSec={nowSec}
          initialFocus={dealFocus ? 'yes' : null}
        />
      ) : (
        <div ref={deckEnd} className="panel-lift p-8 text-center flex flex-col gap-4 items-center">
          {/* Заголовок, а не абзац: на него переезжает фокус с последнего
              голоса (pendingFocus 'end') и объявляет, что колода кончилась.
              Кольцо не снимается — фокус сюда приходит с клавиатуры */}
          <h2 ref={deckEndHead} tabIndex={-1} className="text-lg">
            Колода кончилась
          </h2>
          {/* «На полке», а не «ниже»: с md полка стоит колонкой справа, и под
              панелью пусто — направление верно только на телефоне. «Всё, что
              зацепило» — в пару к «Ничего не зацепило» и без второго
              «приглянул-» рядом с именем полки; «любую игру», а не «любую»:
              без существительного «любую» не с чем согласовать */}
          <p className="text-sm text-dim max-w-md leading-relaxed">
            {liked.length
              ? 'Всё, что зацепило, — на полке «Приглянулось»: открой любую игру — там и трейлер, и кадры, и цена.'
              : 'Ничего не зацепило — это тоже ответ. Можно взять ещё колоду или подобрать под настроение.'}
          </p>
          <div className="flex flex-wrap justify-center items-center gap-4">
            {/* aria-disabled, а не disabled: на отказе панель остаётся, и
                нажатая кнопка обязана удержать фокус — disabled ронял его в
                body на всё время запроса. Повтор гасит сам redeal */}
            <button
              type="button"
              onClick={(e) => void redeal(e.detail === 0)}
              aria-disabled={dealing}
              className="btn-ember px-6 py-3 aria-disabled:opacity-50"
            >
              {dealing ? 'Собираю…' : 'Ещё колоду'}
            </button>
            <Link href="/quiz" className="tap link-more">
              Подобрать под настроение <Icon name="arrow" size={14} />
            </Link>
          </div>
          <p role="status" className="text-sm text-danger max-w-md">
            {redealMiss}
          </p>
        </div>
      )}
      {/* Под колодой и под «Колода кончилась» — одно место: последняя карта
          тоже бывает промахом, и её кнопка не переезжает, когда колода
          уходит. Строка «снова в колоде» стоит всегда: вернувшаяся карта
          в последнем случае встаёт новой колодой, и её собственная живая
          строка рождается вместе с текстом (components/StatusLine) */}
      <StatusLine text={said} className="sr-only" />
      {lastSkip && (
        <p className="mt-4 text-center">
          <button type="button" onClick={(e) => undo(e.detail === 0)} className="tap link-more max-w-full">
            <Icon name="back" size={14} />
            <span className="min-w-0 truncate">Вернуть «{lastSkip.name}»</span>
          </button>
        </p>
      )}
      </div>

      {(liked.length > 0 || shelfTouched) && (
        <section aria-labelledby="explore-shelf" className="flex flex-col gap-4 md:col-start-2 md:row-start-2">
          <SectionLabel>
            <span id="explore-shelf">Приглянулось</span>
          </SectionLabel>
          {/*
            Отказ «Убрать» скринридеру говорит строка полки, а не плитки:
            плитка уходит сразу и возвращается откатом, то есть монтируется
            заново, и живая область внутри неё рождалась бы вместе с текстом —
            такую скринридер объявляет не везде (components/StatusLine). Полка
            же живёт всё это время: shelfTouched ставится до ухода плитки.
          */}
          <StatusLine
            text={
              unlikeMissName ? `Не вышло — «${unlikeMissName}» осталась на полке. Попробуй ещё раз.` : null
            }
            className="sr-only"
          />
          {/* Убрали последнее — полка не исчезает молча и держит фокус строкой.
              Живой области на ней нет: объявляет строку фокус, который сюда
              переезжает, а область, родившаяся вместе с текстом, звучит не везде */}
          {liked.length === 0 && (
            <p ref={shelfEmpty} tabIndex={-1} className="text-sm text-dim">
              С полки всё убрано. «Интересно» в колоде положит сюда новое.
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            {(shelfOpen ? liked : liked.slice(0, EXPLORE_SHELF_FOLD)).map((c) => (
              <div key={c.appid} className="flex flex-col">
                {/* Ссылка и кнопка — соседи, а не вложенные (как у BannedShelf) */}
                <Link
                  href={`/game/${c.appid}`}
                  transitionTypes={['nav-forward']}
                  className="game-card block text-left"
                >
                  <GameCardBody
                    morph
                    appid={c.appid}
                    name={c.name}
                    headerImage={c.headerImage}
                    art={c.art}
                    sizes="(min-width: 768px) 320px, 50vw"
                    corner={<DiscountCorner discount={c.discount} />}
                    meta={
                      c.owned ? (
                        <span className="truncate">в библиотеке</span>
                      ) : (
                        <PriceTag
                          priceFinal={c.priceFinal}
                          cc={c.priceCc}
                          unsold={c.unsold}
                          discount={c.discount}
                          isFree={c.isFree}
                          showPercent={false}
                          className="shrink-0"
                        />
                      )
                    }
                  />
                  {/* Префетч здесь оставлен (lib/gameprefetch.test.ts), но
                      он может не успеть: тогда нажатая плитка ждёт так же,
                      как у GameLink, и так же это показывает */}
                  <TilePending />
                </Link>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) unlikeButtons.current.set(c.appid, el)
                    else unlikeButtons.current.delete(c.appid)
                  }}
                  onClick={() => void unlike(c)}
                  aria-label={`Убрать «${c.name}» с полки`}
                  className="pill mt-3 self-start"
                >
                  Убрать
                </button>
                {/* Для глаза: скринридеру отказ уже сказала строка полки */}
                {unlikeMiss === c.appid && (
                  <p aria-hidden className="pt-2 text-[11px] text-danger">
                    Не вышло — попробуй ещё раз
                  </p>
                )}
              </div>
            ))}
          </div>
          {!shelfOpen && liked.length > EXPLORE_SHELF_FOLD && (
            <button
              type="button"
              onClick={() => {
                // Кнопка уходит вместе со свёрнутой полкой — фокус на первую
                // открывшуюся плитку, а не в body
                const next = liked[EXPLORE_SHELF_FOLD]
                if (next) pendingFocus.current = next.appid
                setShelfOpen(true)
              }}
              className="tap link-more self-start"
            >
              Показать все · <span className="tabular-nums">{liked.length}</span>
              <Icon name="down" size={14} />
            </button>
          )}
        </section>
      )}
    </div>
    </>
  )
}

/** Полка: новое сверху, без повторов, не длиннее EXPLORE_SHELF_MAX */
function mergeShelf(first: ShelfCard[], rest: ShelfCard[]): ShelfCard[] {
  const seen = new Set<number>()
  const out: ShelfCard[] = []
  for (const c of [...first, ...rest]) {
    if (seen.has(c.appid)) continue
    seen.add(c.appid)
    out.push(c)
  }
  return out.slice(0, EXPLORE_SHELF_MAX)
}
