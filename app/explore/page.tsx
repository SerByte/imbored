'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { GameCardBody } from '@/components/GameCard'
import { Icon } from '@/components/Icon'
import { SectionLabel } from '@/components/Labels'
import { NeedSteam } from '@/components/NeedSteam'
import { PrivacyHelp } from '@/components/PrivacyHelp'
import { SwipeDeck, type DeckCard, type DeckLabels } from '@/components/SwipeDeck'
import { WarmupScreen } from '@/components/WarmupScreen'
import type { ExploreCard, ShelfCard } from '@/lib/cards'
import { bounceTo, reconnectHref } from '@/lib/destination'
import { EXPLORE_REASON, EXPLORE_SHELF } from '@/lib/explore'
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

/** Сеть, пятисотка, оборванный ответ. */
const FAIL_UNKNOWN = {
  title: 'Не получилось собрать колоду',
  text: 'Похоже, что-то сломалось по дороге. Попробуй зайти чуть позже.',
}

/**
 * «Интересно» и «Мимо», а не «Играем!» и «Не хочу»: в колоде исследователя
 * никто ничего не обещает — это и есть «без обязательств».
 */
const LABELS: DeckLabels = { yes: 'Интересно', no: 'Мимо' }

/** Плитка полки из карты колоды — приглянувшееся только что, ещё до сервера */
function shelfOf(card: DeckCard): ShelfCard {
  return { appid: card.appid, name: card.name, headerImage: card.headerImage, art: card.art ?? null }
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
  const [nowSec, setNowSec] = useState(0)
  /** «Ещё колоду» едет — кнопка ждёт ответа */
  const [dealing, setDealing] = useState(false)
  /** Запрос «Ещё колоду»: уход со страницы его отменяет */
  const redealing = useRef<AbortController | null>(null)
  /**
   * Почему «Ещё колоду» не собралась — строкой под кнопкой, а не экраном
   * отказа: полка «Приглянулось» на экране, и отнимать её из-за потолка
   * частоты незачем. null — сказать нечего.
   */
  const [redealMiss, setRedealMiss] = useState<string | null>(null)
  /**
   * За какие карты голос уже отдан. Улетающая карта ещё 220 мс живёт в DOM, и
   * второй Enter по ней отправил бы второй свайп той же игры (см. TopCard).
   */
  const votedIds = useRef(new Set<number>())
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
   */
  const show = useCallback(
    async (
      res: Response,
      signal: AbortSignal,
      onMiss?: (code: string | null) => void,
    ): Promise<void> => {
      if (!res.ok) {
        const code = await res
          .json()
          .then((d: { error?: unknown }) => (typeof d.error === 'string' ? d.error : null))
          .catch(() => null)
        if (res.status === 401) {
          if (!signal.aborted) router.push(bounceTo('/explore'))
          return
        }
        if (onMiss) {
          onMiss(code)
          return
        }
        setReason(code)
        setPhase('error')
        return
      }
      setRedealMiss(null)
      const data = (await res.json()) as { cards: ExploreCard[]; liked: ShelfCard[]; nowSec: number }
      votedIds.current = new Set()
      setNowSec(data.nowSec)
      setCards(data.cards)
      setDeckTotal(data.cards.length)
      setVoted(0)
      // Приглянувшееся на этом устройстве (сессия только читает) не теряется
      // с новой колодой: сервер его не знает, но человек его видел
      setLiked((local) => mergeShelf(local, data.liked))
      setReason(null)
      setPhase('ok')
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
        await show(await fetch('/api/explore', { signal }), signal)
      } catch {
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
        if (!first) router.push(bounceTo('/explore'))
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

  /** «Ещё колоду» — без прогрева: каталог уже разобран первым заходом */
  const redeal = async () => {
    if (dealing) return
    const ac = new AbortController()
    redealing.current = ac
    setDealing(true)
    const miss = (code: string | null) => setRedealMiss((FAIL[code ?? ''] ?? FAIL_UNKNOWN).text)
    try {
      await show(await fetch('/api/explore', { signal: ac.signal }), ac.signal, miss)
    } catch {
      if (!ac.signal.aborted) miss(null)
    } finally {
      if (!ac.signal.aborted) setDealing(false)
    }
  }

  /**
   * Свайп. Экран меняется сразу, сервер узнаёт следом: «Интересно» — это
   * 'opened' (слабый сигнал вкуса, как открытая карточка), «Мимо» — 'skipped',
   * оба с причиной explore. Отправка без ожидания, как учебные сигналы /play:
   * потерянный свайп не беда. Сессии только для чтения сервер ответит
   * needsteam — тогда страница перестаёт слать и листает на устройстве.
   */
  const vote = (card: DeckCard, yes: boolean) => {
    if (votedIds.current.has(card.appid)) return
    votedIds.current.add(card.appid)
    setCards((cs) => cs.filter((c) => c.appid !== card.appid))
    setVoted((v) => v + 1)
    if (yes) setLiked((l) => mergeShelf([shelfOf(card)], l))
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

  if (phase === 'loading') {
    return <WarmupScreen progress={prep} message={message} />
  }

  if (phase === 'error') {
    const fail = FAIL[reason ?? ''] ?? FAIL_UNKNOWN
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-lg">{fail.title}</p>
        <p className="text-dim text-sm max-w-md leading-relaxed">{fail.text}</p>
        {reason === 'nolibrary' && (
          <div className="max-w-md text-left">
            <PrivacyHelp />
          </div>
        )}
        {reason === 'nolibrary' ? (
          <Link href={reconnectHref()} className="btn-ember px-6 py-3">
            Подключить заново
          </Link>
        ) : (
          <Link href="/quiz" className="tap text-sm text-dim transition-colors hover:text-ink">
            Подобрать под настроение →
          </Link>
        )}
      </div>
    )
  }

  const top = cards[0]

  return (
    /*
      Две колонки с md: колода слева, заголовок и полка «Приглянулось»
      справа — постер 2:3 во всю ширину прежней колонки был бы выше окна.
      Порядок в разметке прежний (заголовок, колода, полка): на телефоне
      колонка одна, и скринридер читает то же, что видит глаз.
    */
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
          cards={cards}
          onVote={vote}
          votedCount={voted}
          deckTotal={deckTotal}
          alone
          labels={LABELS}
          nowSec={nowSec}
        />
      ) : (
        <div className="panel-lift p-8 text-center flex flex-col gap-4 items-center">
          <p className="text-lg">Колода кончилась</p>
          <p className="text-sm text-dim max-w-md leading-relaxed">
            {liked.length
              ? 'Приглянувшееся лежит ниже — открой любую, там и трейлер, и кадры, и цена.'
              : 'Ничего не зацепило — это тоже ответ. Можно взять ещё колоду или подобрать под настроение.'}
          </p>
          <div className="flex flex-wrap justify-center items-center gap-4">
            <button
              type="button"
              onClick={() => void redeal()}
              disabled={dealing}
              className="btn-ember px-6 py-3 disabled:opacity-50"
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
      </div>

      {liked.length > 0 && (
        <section className="flex flex-col gap-4 md:col-start-2 md:row-start-2">
          <SectionLabel>Приглянулось</SectionLabel>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            {liked.map((c) => (
              <Link key={c.appid} href={`/game/${c.appid}`} className="game-card block text-left">
                <GameCardBody
                  appid={c.appid}
                  name={c.name}
                  headerImage={c.headerImage}
                  art={c.art}
                  sizes="(min-width: 768px) 320px, 50vw"
                />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/** Полка: новое сверху, без повторов, не длиннее EXPLORE_SHELF */
function mergeShelf(first: ShelfCard[], rest: ShelfCard[]): ShelfCard[] {
  const seen = new Set<number>()
  const out: ShelfCard[] = []
  for (const c of [...first, ...rest]) {
    if (seen.has(c.appid)) continue
    seen.add(c.appid)
    out.push(c)
  }
  return out.slice(0, EXPLORE_SHELF)
}
