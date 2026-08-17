'use client'

import { useCallback, useEffect, useRef } from 'react'
import { LONG_FRAME_MS, readSignals, tierFrom } from '@/lib/tier'

/**
 * Ставит data-tier="lean" на <html>, если машина не тянет. И только это.
 *
 * Атрибут пишется мимо React намеренно: он адресует корень документа, живёт
 * вне дерева квиза и читается исключительно из CSS. Состояния в React нет
 * вовсе — иначе понижение уровня перерисовывало бы страницу ровно в тот
 * момент, когда ей тяжело.
 *
 * Замер открывается на ПЕРВОЙ ПЕРЕКРАСКЕ, а не на простое. Мерить самый
 * дешёвый момент и делать выводы по его лёгкости — это мерить не то: пока
 * человек читает первый вопрос, не движется ничего, и любая машина выглядит
 * флагманом.
 */
export function useTier() {
  const sampled = useRef(false)
  const raf = useRef(0)

  // Дешёвые сигналы — сразу. Понижение по ним не требует ни одного кадра.
  useEffect(() => {
    const root = document.documentElement
    if (tierFrom({ ...readSignals(), longFrames: 0, sampled: 0 }) === 'lean') {
      root.dataset.tier = 'lean'
    }
    return () => {
      delete root.dataset.tier
    }
  }, [])

  // Окно наблюдения. Одноразовое: понижение необратимо, повышения нет.
  const sample = useCallback(() => {
    if (sampled.current || typeof window === 'undefined') return
    sampled.current = true

    const root = document.documentElement
    if (root.dataset.tier === 'lean') return

    let long = 0
    let frames = 0
    let prev = performance.now()
    const until = prev + 1200

    const tick = (now: number) => {
      if (now - prev > LONG_FRAME_MS) long += 1
      frames += 1
      prev = now
      if (now < until) {
        raf.current = requestAnimationFrame(tick)
        return
      }
      if (tierFrom({ ...readSignals(), longFrames: long, sampled: frames }) === 'lean') {
        root.dataset.tier = 'lean'
      }
    }
    raf.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  return sample
}
