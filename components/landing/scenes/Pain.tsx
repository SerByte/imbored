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
        const words = [...root.querySelectorAll('[data-pain-word]')]
        const rest = words.slice(1)
        const after = root.querySelector('[data-pain-after]')
        gsap.set(rest, { opacity: 0, y: 40 })
        gsap.set(after, { opacity: 0, y: 20 })
        tl.to(rest, { opacity: 1, y: 0, stagger: 0.28, duration: 0.34, ease: 'power2.out' })
          .to(after, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' }, '>-0.05')
          // Пустой такт в конце: последняя фраза обязана постоять прочитанной,
          // а не смениться следующей сценой в тот же кадр.
          .to({}, { duration: 0.35 })
      }}
    >
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
