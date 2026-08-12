'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Алфавит ДОЛЖЕН совпадать с генератором кодов в app/api/room/create/route.ts.
 * Барабан, показывающий глиф, которого в коде быть не может, — единственное,
 * что отличает «сделано под нас» от «взяли готовый компонент».
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const STEP_MS = 90
const STAGGER_MS = 60

/**
 * Код комнаты, который набирается как на табло вылетов.
 *
 * Доска пати буквально и есть табло: она опрашивается каждые 5 секунд, строки
 * появляются и исчезают, а содержимое — «рейсы, на которые можно подсесть».
 * Код при этом — самая функциональная строка в приложении: его диктуют другу
 * вслух и вставляют в чат.
 *
 * Настоящий текст живёт в отдельном узле для скринридера и копирования;
 * створки скрыты через aria-hidden. Без этого ломается и то, и другое.
 */
export function FlapCode({ code, animate = true }: { code: string; animate?: boolean }) {
  // Начальное состояние — уже готовый код. Так он виден и при выключенном JS,
  // и при reduced-motion, и при любом сбое: створки только перекрывают готовое.
  const [shown, setShown] = useState(code)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const chars = code.split('')
    const settled = Array<string | null>(chars.length).fill(null)
    const handles: number[] = []

    chars.forEach((target, i) => {
      const idx = Math.max(0, ALPHABET.indexOf(target))
      const steps = 6 + i // дальние створки крутятся дольше — код «докатывается» слева направо
      // Створка стартует со сдвигом, а не крутится с нулевой секунды
      const kick = window.setTimeout(() => {
        let n = 0
        const spin = window.setInterval(() => {
          n += 1
          settled[i] = n >= steps ? target : ALPHABET[(idx + steps - n) % ALPHABET.length]
          if (n >= steps) window.clearInterval(spin)
          setShown(chars.map((_, k) => settled[k] ?? ' ').join(''))
        }, STEP_MS)
        handles.push(spin)
      }, i * STAGGER_MS)
      handles.push(kick)
    })

    timers.current = handles
    return () => {
      handles.forEach((t) => {
        window.clearInterval(t)
        window.clearTimeout(t)
      })
    }
  }, [code, animate])

  return (
    <div className="font-mono font-bold text-ember">
      {/*
        Дубль текста нужен скринридеру (створки aria-hidden), но он же попадал
        бы в буфер обмена: выделение строки давало «FCPK8GFCPK8G». Код комнаты —
        ровно то, что копируют и диктуют другу, поэтому этот узел исключён из
        выделения. На озвучку user-select не влияет.
      */}
      <span className="sr-only select-none">{code}</span>
      <span aria-hidden className="inline-flex gap-[2px]">
        {code.split('').map((_, i) => (
          <span
            key={i}
            className="inline-block min-w-[0.72em] text-center"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {shown[i] ?? ' '}
          </span>
        ))}
      </span>
    </div>
  )
}
