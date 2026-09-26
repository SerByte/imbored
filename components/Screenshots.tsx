'use client'

import { m } from 'framer-motion'
import { MotionMax } from '@/components/motion/MotionMax'
import { useState } from 'react'
import { Lightbox } from '@/components/Lightbox'

/**
 * Сетка скриншотов с лайтбоксом.
 *
 * Раньше это был единственный вид блока «Скриншоты». Теперь кадры показывает
 * MorphSlider, а сетка осталась запасным путём: GameShots отдаёт её, когда
 * браузер не смог выдать WebGL-контекст. Кода это не стоит почти ничего, зато
 * на старой машине или в браузере с выключенным WebGL скриншоты не исчезают
 * вовсе — а именно так выглядел бы слайдер без контекста.
 *
 * layoutId — самый честный случай layout-анимации во всём проекте: миниатюра
 * не «открывает модалку», а физически становится полноразмерной картинкой.
 */
export function Screenshots({ images, name }: { images: string[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null)

  // layoutId — фича domMax, её догружает MotionMax
  return (
    <MotionMax>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {images.map((src, i) => (
          <m.button
            key={src}
            layoutId={`shot-${i}`}
            onClick={() => setOpen(i)}
            className="game-card block w-full cursor-pointer rounded-(--radius-card)"
            aria-label={`Скриншот ${i + 1} из ${images.length} — ${name}`}
          >
            <span className="card-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="w-full aspect-video object-cover" />
            </span>
          </m.button>
        ))}
      </div>

      <Lightbox
        images={images}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
        layoutId={(i) => `shot-${i}`}
      />
    </MotionMax>
  )
}
