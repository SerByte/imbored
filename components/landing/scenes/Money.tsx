'use client'

import gsap from 'gsap'
import { Stage } from '@/components/landing/Stage'

/**
 * СЦЕНА 6: О ДЕНЬГАХ И ВОЗВРАТ.
 *
 * Позиция продукта крупно, три строки мелко — и возврат к форме. Лента к концу
 * сцены расцветает и разгоняется: кадр закрывается тем же движением, каким
 * открылся. Свет ведёт общая шкала (lib/ribbonlight.ts), и последняя опорная
 * точка стоит на 0.55 прогресса намеренно — чтобы позиция про деньги читалась
 * на спокойном фоне, а не поверх мельтешения.
 *
 * ВНИЗУ ЯКОРЬ, А НЕ ВТОРАЯ КАРТОЧКА. Два `<input id="steam-profile">` в одном
 * документе — это сломанный `label for` и неуникальный id, а две парадные
 * кнопки «Подобрать игру» — два разных обещания. И голой ссылкой в Steam якорь
 * тоже не заменить: адрес входа собирается из ?join / ?compat / ?next, и
 * голая ссылка увела бы приглашённого в пати на общий подбор.
 */
export function Money() {
  return (
    <Stage
      id="money"
      label="О деньгах и возврат"
      end="+=100%"
      /*
       * Единственная сцена без ухода кадра. Её последний блок — возврат к
       * форме; погасить призыв ровно в тот момент, когда человек дочитал,
       * значит отнять у страницы концовку.
       */
      exit={false}
      enter={(intro, root) => {
        // Кадр сцены: позиция продукта встаёт на подъёме, а не после него.
        const line = root.querySelector('[data-money-line]')
        gsap.set(line, { opacity: 0, y: 30 })
        intro.to(line, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0)
      }}
      build={(tl, root) => {
        const items = root.querySelectorAll('[data-money-item]')
        const back = root.querySelector('[data-money-back]')

        gsap.set(items, { opacity: 0, y: 16 })
        gsap.set(back, { opacity: 0, y: 26 })

        tl.to(items, { opacity: 1, y: 0, stagger: 0.1, duration: 0.3, ease: 'power2.out' }, 0.1)
          .to(back, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }, 0.55)
          .to({}, { duration: 0.3 })
      }}
    >
      {/* Сиденье под текстом и тёплый разлив под возвратом: лента здесь на
          полной яркости, и белое по обложке иначе читается через раз. */}
      <div className="money-glow" aria-hidden />

      <p className="slate">
        <b>06</b>
        <span>О деньгах</span>
      </p>

      {/*
        Ударение на тезисе, а не на всей фразе. Заголовок держал четыре строки
        ровным белым, и главное в нём — «доверие не продаётся» — весило столько
        же, сколько служебное «Мы не продаём места в выдаче».
      */}
      <h2 className="font-display text-display-md" style={{ maxWidth: '20ch' }} data-money-line>
        Мы не продаём места в выдаче. Рекомендация — это доверие,{' '}
        <span className="text-ember-text">а доверие не продаётся</span>.
      </h2>

      <ul className="money-list">
        <li data-money-item>Рекламы в подборе нет.</li>
        <li data-money-item>imbored бесплатен. И останется таким.</li>
        <li data-money-item>Скидка — наклон, а не сортировка.</li>
      </ul>

      <div className="back-block" data-money-back>
        <div className="max-w-md">
          <h3 className="font-display text-display-sm">Подключим твою?</h3>
          <p className="mt-2 text-sm leading-relaxed text-dim">
            Дальше — три вопроса и пять карточек. Не хочешь отдавать свою — на первом экране есть
            демо без Steam.
          </p>
        </div>
        <a className="btn-ember back-btn" href="#main">
          Наверх, к подключению ↑
        </a>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-faint">
        imbored — независимый проект, не связанный с Valve Corporation. Steam и логотип Steam —
        товарные знаки Valve Corporation.
      </p>
    </Stage>
  )
}
