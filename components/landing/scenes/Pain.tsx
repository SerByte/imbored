'use client'

import gsap from 'gsap'
import { Stage } from '@/components/landing/Stage'

/**
 * СЦЕНА 2: ЗАЧЕМ ВСЁ ЭТО.
 *
 * Единственная сцена без единой картинки, и это её приём. Пока фразы титра
 * прилетают одна за другой, лента за ними ЗАМИРАЕТ И ОБЕСЦВЕЧИВАЕТСЯ —
 * «ничего не цепляет» показано фоном, а не сказано словами. Свет лентой правит
 * не отсюда: он считается одной шкалой от позиции прокрутки
 * (см. lib/ribbonlight.ts), и сцена только задаёт своими границами, где эта
 * перемена происходит.
 *
 * Прятать фразы можно ТОЛЬКО здесь, внутри build: при «уменьшить движение»
 * build не вызывается, и титр просто стоит на месте целиком.
 */
export function Pain() {
  return (
    <Stage
      id="pain"
      label="Зачем всё это"
      end="+=110%"
      build={(tl, root) => {
        /*
         * ПЕРВАЯ ФРАЗА НЕ ПРЯЧЕТСЯ, И ЭТО ЛЕЧИТ НАСТОЯЩУЮ ДЫРУ.
         *
         * Между героем и этой сценой есть экран прокрутки, где герой уже
         * растаял, а закрепление ещё не началось. Пока титр прятался целиком,
         * там был пустой кадр: лента и ничего больше. Замерено — 600 px
         * прокрутки, на которых страница выглядит сломанной.
         *
         * Теперь ровно эта фраза и есть «выглядывающая сцена» из-под края
         * первого экрана: человек видит начало мысли до того, как сцена
         * возьмёт управление, а прокрутка её договаривает.
         */
        const words = [...root.querySelectorAll<HTMLElement>('[data-pain-word]')]
        const [, second, third] = words
        const after = root.querySelector('[data-pain-after]')
        const key = root.querySelector('[data-pain-key]')
        const shutter = root.querySelector('[data-pain-shutter]')
        const thumb = root.querySelector('[data-pain-thumb]')

        gsap.set([second, third], { opacity: 0, y: 40 })
        gsap.set(after, { opacity: 0, y: 20 })
        gsap.set(key, { opacity: 0 })
        gsap.set(shutter, { opacity: 0, scale: 1.75 })
        gsap.set(thumb, { yPercent: 0 })

        /*
         * У КАЖДОЙ ФРАЗЫ СВОЙ ЖЕСТ, А НЕ ОБЩИЙ STAGGER.
         *
         * Раньше все три прилетали одинаково, с одним шагом и одной кривой, —
         * то есть сцена произносила ритуал ровным голосом. Здесь три разных
         * события, и они обязаны звучать по-разному:
         *
         *   «Полистал.» приезжает ВЯЛО и коротко — это скучная середина,
         *      её задача не запомниться;
         *   «Закрыл.» БЬЁТ: expo.out, вдвое быстрее, и вместе с ним начинает
         *      сходиться темнота;
         *   свет приходит с первой фразой и УМИРАЕТ на третьей — сцена
         *      начинается освещённой и заканчивается погасшей.
         *
         * Бегунок едет ровно, пока идут первые две фразы, и ОСТАНАВЛИВАЕТСЯ на
         * третьей. Останов — это и есть «закрыл».
         */
        tl.to(key, { opacity: 1, duration: 0.3, ease: 'power2.out' }, 0)
          .to(thumb, { yPercent: 372, duration: 0.62, ease: 'none' }, 0)
          .to(second, { opacity: 1, y: 0, duration: 0.3, ease: 'power1.out' }, 0.24)
          .to(third, { opacity: 1, y: 0, duration: 0.16, ease: 'expo.out' }, 0.62)
          .to(shutter, { opacity: 1, scale: 1, duration: 0.5, ease: 'power2.inOut' }, 0.62)
          .to(key, { opacity: 0.12, duration: 0.45, ease: 'power2.in' }, 0.66)
          .to(after, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' }, 0.86)
          // Пустой такт в конце: последняя фраза обязана постоять прочитанной,
          // а не смениться следующей сценой в тот же кадр.
          .to({}, { duration: 0.35 }, 1.15)
      }}
    >
      {/* Свет комнаты и темнота, которая его съедает. Оба слоя — под текстом:
          гаснуть обязана комната, а не человек в ней. */}
      <div className="pain-key" aria-hidden data-pain-key />
      <div className="pain-shutter" aria-hidden data-pain-shutter />

      {/* Жёлоб с бегунком: он и есть «полистал». Замирает на «Закрыл.». */}
      <div className="pain-scroll" aria-hidden>
        <span className="pain-scroll-thumb" data-pain-thumb />
      </div>

      <p className="slate">
        <b>02</b>
        <span>Зачем всё это</span>
      </p>

      <h2 className="pain-title font-display text-display-lg">
        <span data-pain-word>Открыл Steam.</span>
        <span data-pain-word>Полистал.</span>
        <span data-pain-word className="text-ember-text">
          Закрыл.
        </span>
      </h2>

      <p className="mt-8 max-w-md text-lg leading-relaxed text-dim" data-pain-after>
        Знакомо. Игр много, а зайти не во что.
      </p>
    </Stage>
  )
}
