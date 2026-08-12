'use client'

import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react'
import { useState } from 'react'
import { GameArt } from '@/components/GameArt'

export type DeckCard = {
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

const EASE = [0.22, 1, 0.36, 1] as const
const DEPTH = 3 // сколько карточек видно в стопке

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
  card,
  flyOut,
  onCommit,
}: {
  card: DeckCard
  flyOut: 'left' | 'right' | null
  onCommit: (yes: boolean) => void
}) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-260, 0, 260], [-8, 0, 8])
  const yesGlow = useTransform(x, [0, 160], [0, 1])
  const noFade = useTransform(x, [-160, 0], [1, 0])
  // Игра теряет цвет, когда её отклоняют — смысл, а не украшение.
  const artSaturate = useTransform(noFade, (v: number) => `saturate(${1 - v * 0.8})`)

  return (
    <motion.div
      className="glass rounded-[20px] overflow-hidden relative touch-pan-y"
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{
        x: flyOut === 'left' ? -520 : flyOut === 'right' ? 520 : 0,
        opacity: 0,
        rotate: flyOut === 'left' ? -10 : flyOut === 'right' ? 10 : 0,
        transition: { duration: 0.22, ease: 'easeIn' },
      }}
      transition={{ duration: 0.35, ease: EASE }}
      onDragEnd={(_, info) => {
        const passed = Math.abs(info.offset.x) > 110 || Math.abs(info.velocity.x) > 500
        if (!passed) return
        onCommit(info.offset.x > 0)
      }}
    >
      <div className="relative">
        <motion.div style={{ filter: artSaturate }}>
          <GameArt
            appid={card.appid}
            name={card.name}
            headerImage={card.headerImage}
            className="w-full aspect-[460/215] object-cover"
          />
        </motion.div>
        <motion.div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ opacity: yesGlow, background: 'rgba(255,158,100,0.12)' }}
        />
        <motion.span
          aria-hidden
          className="absolute top-4 left-4 rounded-full bg-ember text-bg px-3 py-1 text-sm font-bold"
          style={{ opacity: yesGlow }}
        >
          Играем!
        </motion.span>
        <motion.span
          aria-hidden
          className="absolute top-4 right-4 rounded-full glass px-3 py-1 text-sm text-dim"
          style={{ opacity: noFade }}
        >
          Не хочу
        </motion.span>
      </div>

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
            onClick={() => onCommit(false)}
            className="rounded-[14px] glass glass-hover py-5 text-lg cursor-pointer active:scale-[0.98] transition"
          >
            ✖ Не хочу
          </button>
          <button
            onClick={() => onCommit(true)}
            className="rounded-[14px] bg-ember text-bg font-bold py-5 text-lg hover:brightness-110 active:scale-[0.98] transition cursor-pointer"
          >
            Играем!
          </button>
        </div>
      </div>
    </motion.div>
  )
}

export function SwipeDeck({
  cards,
  onVote,
  votedCount,
  deckTotal,
}: {
  cards: DeckCard[]
  onVote: (card: DeckCard, yes: boolean) => void
  votedCount: number
  deckTotal: number
}) {
  // Куда улетает верхняя карточка, когда голосуют кнопкой, а не жестом.
  const [flyOut, setFlyOut] = useState<'left' | 'right' | null>(null)

  const top = cards[0]
  if (!top) return null

  const commit = (yes: boolean) => {
    setFlyOut(yes ? 'right' : 'left')
    onVote(top, yes)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative" style={{ minHeight: 420 }}>
        {/* Задние карточки — только глубина, без содержимого и без обработчиков */}
        {cards.slice(1, DEPTH).map((c, i) => (
          <motion.div
            key={c.appid}
            aria-hidden
            className="glass rounded-[20px] overflow-hidden absolute inset-x-0 top-0"
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
              className="w-full aspect-[460/215] object-cover"
            />
            <div className="h-24" />
          </motion.div>
        ))}

        <AnimatePresence mode="popLayout" onExitComplete={() => setFlyOut(null)}>
          {/* key по appid: каждая карточка получает СВОИ motion-значения.
              Общий x на всю колоду оставлял бы следующей карте смещение
              предыдущей и дрался бы с exit-анимацией улетающей. */}
          <TopCard key={top.appid} card={top} flyOut={flyOut} onCommit={commit} />
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden">
          <motion.div
            className="h-full bg-ember rounded-full"
            initial={false}
            animate={{ width: `${deckTotal ? ((votedCount + 1) / deckTotal) * 100 : 0}%` }}
            transition={{ duration: 0.3, ease: EASE }}
          />
        </div>
        <span className="text-xs text-dim/60 font-mono shrink-0">
          {votedCount + 1}/{deckTotal}
        </span>
      </div>
    </div>
  )
}
