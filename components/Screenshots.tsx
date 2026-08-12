'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Шесть скриншотов игры с лайтбоксом.
 *
 * До этого у них не было вообще ничего: ни увеличения, ни даже glass-hover —
 * единственный блок в приложении без реакции на наведение, хотя это ровно тот
 * контент, который хочется рассмотреть перед покупкой.
 *
 * layoutId — самый честный случай layout-анимации во всём проекте: миниатюра
 * не «открывает модалку», а физически становится полноразмерной картинкой.
 *
 * Клиентский островок: /game/[appid] остаётся серверным компонентом.
 */
export function Screenshots({ images, name }: { images: string[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null)

  // Escape и стрелки: лайтбокс без клавиатуры — это ловушка
  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? null : (i + 1) % images.length))
      if (e.key === 'ArrowLeft')
        setOpen((i) => (i === null ? null : (i - 1 + images.length) % images.length))
    }
    window.addEventListener('keydown', onKey)
    // фон не должен скроллиться под открытым лайтбоксом
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, images.length])

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {images.map((src, i) => (
          <motion.button
            key={src}
            layoutId={`shot-${i}`}
            onClick={() => setOpen(i)}
            className="glass glass-hover rounded-[14px] overflow-hidden cursor-pointer"
            aria-label={`Скриншот ${i + 1} из ${images.length} — ${name}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" loading="lazy" className="w-full aspect-video object-cover" />
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {open !== null && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`Скриншот ${open + 1} из ${images.length}`}
          >
            <div aria-hidden className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
            <motion.img
              layoutId={`shot-${open}`}
              src={images[open]}
              alt=""
              className="relative max-h-[85vh] w-auto max-w-full rounded-[20px] border border-edge"
              transition={{ duration: 0.35, ease: EASE }}
            />
            <button
              onClick={(e) => {
                e.stopPropagation()
                setOpen(null)
              }}
              aria-label="Закрыть"
              className="absolute top-5 right-5 rounded-full glass px-4 py-2 text-sm cursor-pointer"
            >
              Закрыть ✕
            </button>
            <span className="absolute bottom-5 font-mono text-xs text-dim">
              {open + 1}/{images.length}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
