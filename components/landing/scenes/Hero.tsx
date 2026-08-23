'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Suspense, useRef } from 'react'
import { ConnectCard } from '@/components/landing/ConnectCard'
import { ConnectFallback } from '@/components/landing/ConnectFallback'
import { HeroNotice } from '@/components/landing/HeroNotice'
import { Wordmark } from '@/components/Wordmark'

gsap.registerPlugin(ScrollTrigger, useGSAP)

/**
 * ПЕРВЫЙ ЭКРАН: ДОСТУП СРАЗУ.
 *
 * Одной колонкой по центру — логотип, обещание, карточка подключения. Ровно
 * так, как было в самой первой версии продукта, и это осознанный возврат:
 * человек, который уже решил (вернулся, пришёл по приглашению в пати,
 * вернулся из Steam с ошибкой), обязан иметь возможность действовать с первого
 * кадра, не читая рассказ о продукте.
 *
 * ВЫСОТА 92svh, А НЕ 100 — и это не небрежность. Из-под нижнего края видно
 * верхушку следующей сцены, и это половина подсказки «здесь есть ещё»; вторая
 * половина — строка со стрелкой. Лента идёт за кадром непрерывно, поэтому
 * экран всё равно читается полноэкранным, а не обрезанным.
 *
 * Заголовок и обещание — обычная разметка, она уезжает в статический HTML.
 * Карточка и строка намерения читают адрес и потому живут за границами
 * Suspense: на предрендеренном маршруте всё дерево до ближайшей границы уходит
 * в клиентский рендер, и границы держат этот рендер маленьким.
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const root = ref.current
      if (!root) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      // Уход первого экрана: содержимое чуть отстаёт от прокрутки и тает.
      // Не закрепление: герой обязан уехать, а не залипнуть — иначе подсказка
      // «мотай вниз» опровергается первым же движением колеса.
      gsap.to(root.querySelector('[data-hero-body]'), {
        y: -90,
        opacity: 0,
        ease: 'none',
        scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: true },
      })
      gsap.to(root.querySelector('[data-hero-cue]'), {
        opacity: 0,
        ease: 'none',
        scrollTrigger: { trigger: root, start: 'top top', end: '35% top', scrub: true },
      })
    },
    { scope: ref },
  )

  return (
    <section ref={ref} className="hero">
      <div className="hero-body" data-hero-body>
        <Suspense fallback={null}>
          <HeroNotice />
        </Suspense>

        <h1 className="hero-wordmark">
          <Wordmark />
        </h1>

        <p className="hero-lede">
          Скажи, сколько у тебя времени, — подберём, во что зайти прямо сейчас.
        </p>

        {/*
          ФОЛБЭК ЗДЕСЬ — НЕ ЗАГЛУШКА, А РАБОЧАЯ ДВЕРЬ: именно он попадает в
          статическую разметку, и без него человек без JS не смог бы войти
          вовсе. Он же держит высоту коробки, чтобы подмена не двигала первый
          экран. См. components/landing/ConnectFallback.tsx.
        */}
        <Suspense fallback={<ConnectFallback />}>
          <ConnectCard />
        </Suspense>
      </div>

      <a className="hero-cue tap" href="#scene-pain" data-hero-cue>
        <span>Что это такое</span>
        <span aria-hidden className="hero-cue-arrow">
          ↓
        </span>
      </a>
    </section>
  )
}
