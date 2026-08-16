'use client'

import { AnimatePresence, motion } from 'motion/react'
import { GameArt } from '@/components/GameArt'
import type { QuizCover } from '@/lib/quizart'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Обложка, размытая до состояния подложки: фон, который знает, о чём экран.
 *
 * Рецепт целиком заимствован у церемонии матча — размытый герой плюс виньетка,
 * гасящая края в фон страницы. Ничего нового, и это намеренно: экраны, где арт
 * работает атмосферой, а не содержанием, должны быть сделаны из одного
 * материала.
 *
 * Живёт в двух местах: в квизе следует за наведённым ответом, на экране
 * ожидания держит обложку последнего выбора — так картинка доезжает вместе со
 * словами, а не обрывается на переходе.
 *
 * Зерно НЕ здесь: у обоих вызывающих экранов оно уже своё, и второй слой поверх
 * первого удваивал бы плотность.
 *
 * Без z-index. Компонент стоит в разметке ПЕРЕД содержимым, и порядка в дереве
 * достаточно — то же правило, что у .blur-band и у ленты «Что нового».
 *
 * AnimatePresence без mode: обе обложки на мгновение сосуществуют, и это как
 * раз то, что нужно — перетекание, а не подмена встык.
 */
export function ArtWash({ cover }: { cover: QuizCover | null }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {cover && (
          <motion.div
            key={cover.appid}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="absolute inset-0"
          >
            <GameArt
              appid={cover.appid}
              name={cover.name}
              headerImage={cover.headerImage}
              art={cover.art}
              // Обложка 460×215, растянутая на весь экран и размытая в кисель:
              // разрешение здесь не значит ничего, а лишний мегабайт значит.
              sizes="100vw"
              className="h-full w-full scale-125 object-cover blur-3xl"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(60% 60% at 50% 45%, transparent, var(--bg) 90%)',
        }}
      />
    </div>
  )
}
