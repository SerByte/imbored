'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import type { Trailer } from '@/lib/trailer'

/**
 * ЖИВОЙ ГЕРОЙ: беззвучный микротрейлер наплывом поверх арта после паузы.
 *
 * Так делает стриминг: постер стоит пару секунд, потом начинает двигаться.
 * Ролик — микротрейлер Steam на 6–8 секунд без звука (lib/trailer.ts), тот
 * же, что TrailerPreview показывает по нажатию; здесь он — фон.
 *
 * НЕ ЗАПУСКАЕТСЯ, когда движение просили убрать, когда включена экономия
 * трафика, на узком экране (телефон — это мобильные данные и батарея, а фон
 * там всё равно закрыт текстом) и когда герой вне экрана.
 *
 * WCAG 2.2.2: движение дольше пяти секунд обязано останавливаться. Кнопка-круг
 * «Пауза» стоит в углу героя, пока ролик идёт; остановленный — остаётся
 * остановленным до следующей игры (компонент живёт в секции с key=appid).
 *
 * Ни байта до решения: <video> не рендерится, пока не прошла пауза, а
 * preload="none" — ролик качает только play(). Пятёрку /play листают руками,
 * и пролистанная за две секунды карточка не должна стоить мегабайтов
 * (сторож «видео на страницах» в lib/trailer.test.ts).
 *
 * Видео декоративно (aria-hidden): смысл несёт арт и текст героя, а ролик
 * со звуком доступен кнопкой «В движении» ниже.
 */
const WAIT_MS = 2500

export function HeroTrailer({ trailer }: { trailer: Trailer | null | undefined }) {
  const [armed, setArmed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [stopped, setStopped] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!trailer) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(min-width: 768px)').matches) return
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (conn?.saveData) return
    const t = window.setTimeout(() => setArmed(true), WAIT_MS)
    return () => window.clearTimeout(t)
  }, [trailer])

  // Играет, только пока герой на экране и человек не остановил
  useEffect(() => {
    const v = video.current
    if (!armed || !v) return
    if (stopped) {
      v.pause()
      return
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) void v.play().catch(() => {})
      else v.pause()
    })
    io.observe(v)
    return () => io.disconnect()
  }, [armed, stopped])

  if (!trailer || !armed) return null

  return (
    <>
      <div aria-hidden className={`hero-trailer hero-layer ${playing && !stopped ? 'is-on' : ''}`}>
        <video
          ref={video}
          muted
          playsInline
          loop
          preload="none"
          onPlaying={() => setPlaying(true)}
          className="h-full w-full object-cover"
        >
          {trailer.webm && <source src={trailer.webm} type="video/webm" />}
          <source src={trailer.mp4} type="video/mp4" />
        </video>
      </div>
      {playing && (
        <button
          type="button"
          onClick={() => setStopped(!stopped)}
          aria-pressed={stopped}
          aria-label={stopped ? 'Включить фоновое видео' : 'Остановить фоновое видео'}
          title={stopped ? 'Включить фоновое видео' : 'Остановить фоновое видео'}
          className="btn-circle hero-trailer-toggle"
        >
          <Icon name={stopped ? 'play' : 'pause'} size={18} />
        </button>
      )}
    </>
  )
}
