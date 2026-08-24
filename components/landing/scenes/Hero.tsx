'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Suspense, useRef } from 'react'
import { ConnectCard } from '@/components/landing/ConnectCard'
import { ConnectFallback } from '@/components/landing/ConnectFallback'
import { HeroNotice } from '@/components/landing/HeroNotice'
import { Wordmark } from '@/components/Wordmark'
import { DUR, EASE_GSAP, EASE_STRIKE_GSAP } from '@/lib/motion'

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

      /*
       * ВХОД ПЕРВОГО ЭКРАНА.
       *
       * Только gsap.from и только здесь — никаких .anim-* классов с fill-mode.
       * Причина выписана в докблоке .anim-page-in в globals.css и охраняется
       * lib/firstpaint.test.ts: `both` держит кадр `from` до старта, и если
       * анимация не пойдёт (скрытая вкладка, приостановленная композиция,
       * сбойный чанк), первый экран останется пустым. Сюда мы вообще не
       * доходим при «уменьшить движение» — значит и в покое, и без JS герой
       * виден целиком.
       *
       * Порядок тактов — это порядок чтения: знак, его зачёркивание, обещание,
       * дверь, подсказка. Каждый следующий начинается раньше, чем кончился
       * предыдущий: так экран собирается, а не выкладывается по одному.
       *
       * ВХОД НЕ НАЧИНАЕТСЯ В ФОНОВОЙ ВКЛАДКЕ, и это не оптимизация.
       *
       * gsap.from ставит начальное состояние НЕМЕДЛЕННО, а снимает его только
       * когда твин пошёл. В скрытой вкладке requestAnimationFrame не идёт —
       * твин не стартует, и первый экран остаётся пустым до тех пор, пока на
       * него не посмотрят. Поймано здесь же, на живой странице: логотип стоял,
       * а зачёркивание, обещание, карточка и подсказка не появились вовсе.
       *
       * Это ровно та ловушка, из-за которой в проекте запрещён fill-mode: both
       * (см. докблок .anim-page-in) — gsap.from ошибается точно так же. Правило
       * одно: анимация может добавить появление, но не может стать условием
       * того, что контент вообще виден. Вкладка открыта в фоне — человек
       * увидит собранный экран без церемонии, и это правильный размен.
       */
      if (document.visibilityState === 'visible') {
        gsap
          .timeline()
          .from('[data-hero-wordmark]', {
            y: 18,
            opacity: 0,
            duration: DUR.slow,
            ease: EASE_GSAP,
          }, 0.15)
          /*
           * ГЛАВНЫЙ ТАКТ. --ease-strike описан как «контакт: ~90% пути за
           * первые 12% времени, свет БЬЁТ, а не приезжает» — и написан он ровно
           * под такой жест. Зачёркивание не выезжает, оно ПРОВОДИТСЯ.
           *
           * Отдельным элементом, потому что text-decoration не анимируется;
           * см. проп drawable у components/Wordmark.tsx.
           */
          .from('[data-wordmark-strike]', {
            scaleX: 0,
            duration: DUR.base,
            ease: EASE_STRIKE_GSAP,
          }, 0.45)
          .from('[data-hero-lede]', { y: 12, opacity: 0, duration: DUR.base, ease: EASE_GSAP }, 0.55)
          .from('[data-hero-card]', { y: 20, opacity: 0, duration: DUR.slow, ease: EASE_GSAP }, 0.7)
          .from('[data-hero-cue]', { opacity: 0, duration: DUR.base, ease: EASE_GSAP }, 0.95)
      }

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

        <h1 className="hero-wordmark" data-hero-wordmark>
          <Wordmark drawable />
        </h1>

        <p className="hero-lede" data-hero-lede>
          Скажи, сколько у тебя времени, — подберём, во что зайти прямо сейчас.
        </p>

        {/*
          ФОЛБЭК ЗДЕСЬ — НЕ ЗАГЛУШКА, А РАБОЧАЯ ДВЕРЬ: именно он попадает в
          статическую разметку, и без него человек без JS не смог бы войти
          вовсе. Он же держит высоту коробки, чтобы подмена не двигала первый
          экран. См. components/landing/ConnectFallback.tsx.
        */}
        {/* w-full обязателен: .hero-body — флекс-колонка с центрированием, и
            обёртка без ширины схлопнулась бы по содержимому, утащив за собой
            карточку вместе с её max-w-md. */}
        <div className="flex w-full justify-center" data-hero-card>
          <Suspense fallback={<ConnectFallback />}>
            <ConnectCard />
          </Suspense>
        </div>
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
