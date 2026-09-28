'use client'

import {
  AnimatePresence,
  m,
  useIsPresent,
  useMotionValue,
  useTransform,
  type Variants,
} from 'framer-motion'
import { MotionMax } from '@/components/motion/MotionMax'
import { useEffect, useRef, useState } from 'react'
import { GameArt } from '@/components/GameArt'
import { Icon } from '@/components/Icon'
import { PlayersNow } from '@/components/PlayersNow'
import type { GameArtUrls } from '@/lib/art'
import { deckCardLine, deckPosition } from '@/lib/deckvote'
import type { Discount } from '@/lib/discount'
import type { GameTrait } from '@/lib/gametraits'
import { tagRu } from '@/lib/tagsru'

export type DeckCard = {
  appid: number
  name: string
  ownedByAll: boolean
  missingFor: string[]
  priceFinal?: number
  /** бесплатная — цены нет, даже если она лежит в каталоге (см. GroupCard) */
  isFree?: boolean
  discount?: Discount | null
  headerImage: string | null
  art?: GameArtUrls | null
  ccu?: number | null
  ccuAt?: number | null
  /** «Матч ~15 мин» / «Сессия на вечер» из уверенной семантики (sessionTrait); нет — не знаем */
  session?: GameTrait | null
  tags: string[]
  store?: string
  storeUrl?: string
  /**
   * Почему эта игра — только у колоды исследователя (/explore, exploreCardView):
   * там колоду собрал подбор, и ему есть что сказать. В пати карту объясняет
   * общий вкус комнаты, а не фраза.
   */
  reason?: string
  /**
   * Своя игра-ориентир (exploreCardView): у игры не из Steam её размытый арт
   * ложится под типографскую обложку. В пати ориентира нет.
   */
  via?: { appid: number; name: string } | null
}

/**
 * Подписи голосов. В пати — «Играем!» и «Не хочу»: это голос за вечер вместе.
 * В колоде исследователя играть никто не обещает — там «Интересно» и «Мимо».
 */
export type DeckLabels = { yes: string; no: string }

const PARTY_LABELS: DeckLabels = { yes: 'Играем!', no: 'Не хочу' }

const EASE = [0.22, 1, 0.36, 1] as const
const DEPTH = 3 // сколько карточек видно в стопке

type Fly = 'left' | 'right' | null

/*
 * Вылет — вариантом с аргументом, а не объектом в exit.
 *
 * Объект читал flyOut из пропсов карты, а у улетающей карты пропсы
 * заморожены: AnimatePresence держит её последний элемент, отрисованный ДО
 * голоса. Направление и удаление карты из колоды приходят одним рендером
 * (commit ставит flyOut, onVote в том же обработчике убирает карту), так что
 * карта уходила с flyOut === null — растворялась на месте, а после жеста
 * возвращалась к центру. Аргумент AnimatePresence (custom) доезжает до
 * уходящих детей свежим — ровно для этого он и существует.
 */
const FLY: Variants = {
  gone: (dir: Fly) => ({
    x: dir === 'left' ? -520 : dir === 'right' ? 520 : 0,
    opacity: 0,
    rotate: dir === 'left' ? -10 : dir === 'right' ? 10 : 0,
    transition: { duration: 0.22, ease: 'easeIn' },
  }),
}

/**
 * Колода пати.
 *
 * До этого «свайп-колода» была радиогруппой: сервер отдавал 20 карт, клиент
 * рендерил ровно одну и подменял её на голосовании. Ни стопки, ни жеста, ни
 * вылета — самый тактильный экран продукта был физически беднее, чем список.
 *
 * Три решения, которые здесь важнее самой анимации:
 *
 * 1. Кнопки остаются и дёргают тот же программный вылет, что и жест. Гест и тап
 *    делят один выход, поэтому клавиатура и скринридер ничего не теряют.
 * 2. Цвет несёт смысл: вправо — ember-заливка, влево — арт теряет насыщенность.
 *    Игра буквально выцветает, когда её отклоняют. Никаких зелёных и красных:
 *    в палитре их нет.
 * 3. В покое поворота нет. Джиттера нет нигде в дизайне, и стопка ровных
 *    матовых панелей читается дороже, чем веер игральных карт.
 */
function TopCard({
  nowSec,
  card,
  alone,
  labels,
  focusOn,
  onCommit,
}: {
  /** серверные часы ответа /deck — см. PlayersNow */
  nowSec: number
  card: DeckCard
  alone: boolean
  labels: DeckLabels
  /** прошлый голос был с клавиатуры — фокус встаёт на ту же кнопку этой карты */
  focusOn: 'yes' | 'no' | null
  /** keyboard — голос кнопкой с клавиатуры или скринридера, а не пальцем */
  onCommit: (yes: boolean, keyboard: boolean) => void
}) {
  /*
   * УЛЕТАЮЩАЯ КАРТА БОЛЬШЕ НЕ ГОЛОСУЕТ.
   *
   * Она живёт в DOM ещё 220 мс анимации вместе с кнопками и обработчиком,
   * который помнит её саму. Замерено: Enter на «✖ Не хочу», через 60 мс фокус
   * всё ещё на её кнопке, второй Enter — ещё один голос за ту же игру, и
   * прогресс прыгал через карту. Страница второй голос теперь отбрасывает
   * (claimVote в lib/deckvote), а здесь уходящая карта перестаёт быть целью
   * вовсе: inert снимает с неё фокус и клики.
   *
   * inert, а не disabled на кнопках: выключенная .btn-ember перекрашивается в
   * обводку, и «Играем!» мигало бы другим видом ровно на вылете.
   *
   * Признак — присутствие в AnimatePresence, а не flyOut колоды: карта,
   * вернувшаяся после отказа голоса, снова присутствует, и её кнопки обязаны
   * работать сразу, не дожидаясь конца чужой анимации.
   */
  const present = useIsPresent()
  const noRef = useRef<HTMLButtonElement>(null)
  const yesRef = useRef<HTMLButtonElement>(null)

  /*
   * Кнопка, в которой был фокус, уехала вместе с картой, и фокус падал в
   * body — человека с клавиатурой выкидывало в начало документа после
   * КАЖДОГО голоса. Новая карта забирает его на ту же кнопку: следующий
   * Enter — следующий голос тем же жестом. Голос пальцем фокус не двигает:
   * там его и не было.
   */
  useEffect(() => {
    if (focusOn === 'yes') yesRef.current?.focus({ preventScroll: true })
    else if (focusOn === 'no') noRef.current?.focus({ preventScroll: true })
  }, [focusOn])

  const send = (yes: boolean, keyboard: boolean) => {
    if (!present) return
    onCommit(yes, keyboard)
  }

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-260, 0, 260], [-8, 0, 8])
  const yesGlow = useTransform(x, [0, 160], [0, 1])
  const noFade = useTransform(x, [-160, 0], [1, 0])
  // Игра теряет цвет, когда её отклоняют — смысл, а не украшение.
  const artSaturate = useTransform(noFade, (v: number) => `saturate(${1 - v * 0.8})`)

  return (
    <m.div
      /* panel-lift — общий материал панелей продукта: замерено, у колоды был
         box-shadow ровно none, то есть плоское стекло. Карточка, которую
         листают и по которой голосуют, — тот же предмет, что карточка ответа в
         квизе и карточка подключения на первом экране. */
      className="deck-card media-card relative touch-pan-y"
      style={{ x, rotate }}
      inert={!present}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      variants={FLY}
      exit="gone"
      transition={{ duration: 0.35, ease: EASE }}
      onDragEnd={(_, info) => {
        const passed = Math.abs(info.offset.x) > 110 || Math.abs(info.velocity.x) > 500
        if (!passed) return
        send(info.offset.x > 0, false)
      }}
    >
      {/*
        ПОСТЕР НА ВСЮ КАРТУ. Колоду листают ради игр, а не ради подписей:
        капсула 460×215 над столбцом текста делала карту анкетой с
        картинкой. Теперь это обложка 2:3, как в каталоге стриминга, и всё
        остальное лежит поверх её нижней части на тёмном градиенте.
      */}
      {/* pointer-events-none: мышь, нажатая на <img>, запускает родной
          перетаск картинки браузера, и тот съедает жест — карта на десктопе
          не тянулась вовсе (на таче родного перетаска нет). Нажатие проходит
          сквозь постер к самой карте. */}
      <m.div aria-hidden className="absolute inset-0 pointer-events-none" style={{ filter: artSaturate }}>
        <GameArt
          appid={card.appid}
          name={card.name}
          headerImage={card.headerImage}
          art={card.art}
          variant="poster"
          sizes="(min-width: 768px) 440px, 100vw"
          eager
          anchor={card.via}
          className="h-full w-full object-cover"
          fallback={<div className="deck-noart h-full w-full" />}
        />
      </m.div>
      <div aria-hidden className="deck-scrim" />
      <m.div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ opacity: yesGlow, background: 'rgba(70,211,105,0.14)' }}
      />
      {/* Штампы: наклонены, как печать на карточке, — «да» заливкой, «нет»
          контуром. Проявляются жестом, а не стоят всегда. */}
      <m.span
        aria-hidden
        className="deck-stamp left-5 -rotate-12 bg-ember text-on-ember uppercase tracking-wide"
        style={{ opacity: yesGlow }}
      >
        {labels.yes}
      </m.span>
      <m.span
        aria-hidden
        className="deck-stamp right-5 rotate-12 border-2 border-ink text-ink uppercase"
        style={{ opacity: noFade }}
      >
        {labels.no}
      </m.span>

      <div className="relative mt-auto p-5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-display text-display-sm">{card.name}</h2>
          {/*
            ФАКТ ПРО «ВСЕХ» — НЕ ФАКТ, ПОКА ЧЕЛОВЕК ОДИН.
            Колода открыта и в одиночку: голоса копятся заранее, чтобы к
            приходу друга уже было что сводить. Но ownedByAll в комнате из
            одного участника истинно по определению, и каждая карта получала
            зелёное «✓ Есть у всех» — самым громким токеном палитры, в ответ
            на вопрос, которого никто не задавал. Хуже того, плашка приучала
            к неверному: десять карт подряд зелёные, входит друг — и та же
            карта вдруг «Нет у: …». Смысл менялся под рукой, молча.
            В одиночку у своей игры плашки нет вовсе, а у чужой остаётся то,
            что и правда полезно одному: цена и скидка.
          */}
          {card.ownedByAll ? (
            alone ? null : (
              <span className="inline-flex items-center gap-1 rounded-full bg-ok/15 text-ok px-3 py-1 text-xs font-semibold">
                <Icon name="check" size={12} />
                Есть у всех
              </span>
            )
          ) : (
            <span className="flex items-center gap-2">
              {/* text-info вместо sky-300: на светлой теме tailwind-цвет давал
                  1.52:1, то есть подпись была практически невидима */}
              <span className="rounded-full bg-info/10 text-info px-3 py-1 text-xs">
                {alone ? 'Нет в твоей библиотеке' : `Нет у: ${card.missingFor.join(', ')}`}
                {/* «бесплатно» первым, как в PriceTag: иначе у CS2 здесь
                    стояла цена Prime — « · $15» за бесплатную игру */}
                {card.isFree
                  ? ' · бесплатно'
                  : card.priceFinal !== undefined && card.priceFinal > 0
                    ? ` · $${(card.priceFinal / 100).toFixed(0)}`
                    : card.store
                      ? ' · бесплатно/вне Steam'
                      : ''}
              </span>
              {/* Скидка отдельной плашкой, а не внутри синей: там один токен
                  «кому не хватает», и зачёркнутая цена сломала бы его цельность */}
              {card.discount && (
                <span className="rounded-full bg-ember/15 text-ember-text px-2.5 py-1 text-xs font-bold tabular-nums">
                  −{card.discount.percent}%
                </span>
              )}
            </span>
          )}
        </div>
        {card.reason && <p className="text-sm text-ink/80 leading-relaxed line-clamp-2 md:line-clamp-3">{card.reason}</p>}
        {/* для вечера вместе онлайн — самый важный факт: есть ли с кем играть;
            второй — сколько уйдёт на заход: «успеем до ночи?». Обёртка —
            только когда есть что в неё положить: пустая заняла бы в колонке
            лишний зазор gap-3 там, где раньше не было ничего */}
        {(typeof card.ccu === 'number' || card.session) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <PlayersNow ccu={card.ccu ?? null} ccuAt={card.ccuAt} nowSec={nowSec} />
            {card.session && (
              <span className="text-dim">
                {card.session.label.toLowerCase()} {card.session.value}
              </span>
            )}
          </div>
        )}
        {card.tags.length > 0 && (
          // Строкой через точку, как жанры под названием у стриминга;
          // ключи английские, подпись русская — см. lib/tagsru.ts
          <p className="text-sm text-dim line-clamp-1 md:line-clamp-2">{card.tags.map((t) => tagRu(t)).join(' · ')}</p>
        )}
        <div className="grid grid-cols-2 gap-3 mt-1.5">
          {/* detail === 0 — щелчок без мыши: Enter, пробел или скринридер */}
          <button
            ref={noRef}
            type="button"
            onClick={(e) => send(false, e.detail === 0)}
            className="btn-glass w-full py-4 text-lg"
          >
            <Icon name="close" size={20} />
            {labels.no}
          </button>
          <button
            ref={yesRef}
            type="button"
            onClick={(e) => send(true, e.detail === 0)}
            className="btn-ember is-block font-bold py-4 text-lg"
          >
            {labels.yes}
          </button>
        </div>
      </div>
    </m.div>
  )
}

export function SwipeDeck({
  cards,
  onVote,
  votedCount,
  deckTotal,
  alone = false,
  labels = PARTY_LABELS,
  nowSec,
}: {
  cards: DeckCard[]
  onVote: (card: DeckCard, yes: boolean) => void
  votedCount: number
  deckTotal: number
  /** В комнате пока один человек — см. плашку владения в TopCard. */
  alone?: boolean
  /** Подписи голосов; по умолчанию — пати */
  labels?: DeckLabels
  /** серверные часы ответа /deck — см. PlayersNow */
  nowSec: number
}) {
  // Куда улетает верхняя карточка — и кнопкой, и жестом.
  const [flyOut, setFlyOut] = useState<Fly>(null)
  const [focusOn, setFocusOn] = useState<'yes' | 'no' | null>(null)

  const top = cards[0]
  if (!top) return null

  const commit = (yes: boolean, keyboard: boolean) => {
    setFlyOut(yes ? 'right' : 'left')
    setFocusOn(keyboard ? (yes ? 'yes' : 'no') : null)
    onVote(top, yes)
  }

  const pos = deckPosition(votedCount, deckTotal)

  return (
    // drag у верхней карты — фича domMax, её догружает MotionMax.
    // Не шире 460: постер 2:3 во всю колонку комнаты (672) становился
    // альбомным кадром, и карта переставала быть обложкой
    <MotionMax>
      <div className="mx-auto flex w-full max-w-[460px] flex-col gap-4">
        <div className="deck-stack relative">
          {/* Задние карточки — только глубина, без содержимого и без обработчиков */}
          {cards.slice(1, DEPTH).map((c, i) => (
            <m.div
              key={c.appid}
              aria-hidden
              className="deck-card deck-back media-card absolute inset-x-0 top-0"
              initial={false}
              animate={{
                scale: 1 - (i + 1) * 0.04,
                y: (i + 1) * 8,
                opacity: i === 0 ? 0.5 : 0.25,
              }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <GameArt
                appid={c.appid}
                name={c.name}
                headerImage={c.headerImage}
                art={c.art}
                variant="poster"
                sizes="440px"
                className="h-full w-full object-cover"
                fallback={<div className="deck-noart h-full w-full" />}
              />
            </m.div>
          ))}

          <AnimatePresence mode="popLayout" custom={flyOut} onExitComplete={() => setFlyOut(null)}>
            {/* key по appid: каждая карточка получает СВОИ motion-значения.
                Общий x на всю колоду оставлял бы следующей карте смещение
                предыдущей и дрался бы с exit-анимацией улетающей. */}
            <TopCard
              key={top.appid}
              card={top}
              alone={alone}
              labels={labels}
              focusOn={focusOn}
              onCommit={commit}
              nowSec={nowSec}
            />
          </AnimatePresence>
        </div>

        {/*
          Новая карта сверху — новость для того, кто не смотрит на экран: см.
          deckCardLine. Регион вне AnimatePresence и живёт всё время колоды —
          живая область, вставленная вместе с текстом, звучит не везде.
        */}
        <p role="status" aria-live="polite" className="sr-only">
          {deckCardLine(pos, top.name)}
        </p>

        {/* Числитель зажат знаменателем — почему, см. deckPosition в lib/deckvote */}
        <div className="flex items-center gap-3">
          <div className="h-1 flex-1 rounded-full bg-track overflow-hidden">
            <m.div
              className="h-full bg-ember rounded-full"
              initial={false}
              animate={{ width: `${pos.pct}%` }}
              transition={{ duration: 0.3, ease: EASE }}
            />
          </div>
          {/* aria-hidden: номер карты скринридер слышит в строке выше, вместе с игрой */}
          <span aria-hidden className="text-xs font-bold text-faint tabular-nums shrink-0">
            {pos.label}
          </span>
        </div>
      </div>
    </MotionMax>
  )
}
