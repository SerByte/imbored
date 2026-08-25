'use client'

import gsap from 'gsap'
import type { CSSProperties } from 'react'
import { GameArt } from '@/components/GameArt'
import { Eyebrow } from '@/components/Labels'
import { Stage } from '@/components/landing/Stage'
import type { LandingDemo } from '@/lib/landing'

/**
 * СЦЕНА 4: СОВМЕСТИМОСТЬ И ПАТИ.
 *
 * Две стопки библиотек съезжаются к центру, общее остаётся строками с двумя
 * числами, числа набегают. Смысл сцены — «по-настоящему, а не по анкете», и
 * доказывают его именно часы с обеих сторон, а не проценты.
 *
 * ПРОЦЕНТА СОВПАДЕНИЯ ЗДЕСЬ НЕТ, И ЭТО САМОЕ УБЕДИТЕЛЬНОЕ, ЧТО МОЖНО СКАЗАТЬ.
 * Он считается по редкости тегов во всём каталоге, а у гостя каталога нет:
 * посчитанный на демо, он был бы красивым и неправдивым. Отказ напечатан
 * словами — мелким кеглем, но напечатан.
 *
 * Счётчики крутятся твином по объекту, а не компонентом CountNumber: сцена
 * скрублена, и число обязано ехать назад ровно так же, как вперёд.
 */
export function Compat({ demo }: { demo: LandingDemo }) {
  const compat = demo.compat
  const shared = compat.rows.length
  // Стопки — настоящие обложки демо-библиотеки: две половины одного набора
  // читаются как две библиотеки, съезжающиеся к общему.
  const left = demo.wall.slice(0, 6)
  const right = demo.wall.slice(6, 12)
  /**
   * Общий потолок шкал. Единица, а не ноль, в запасном значении: на пустой
   * таблице делить не на что, а деление на ноль вернуло бы NaN прямо в стиль.
   */
  const peak = Math.max(1, ...compat.rows.flatMap((r) => [r.a, r.b]))

  /**
   * ДЛИНА ШКАЛЫ — КОРЕНЬ ОТ ДОЛИ, А НЕ САМА ДОЛЯ.
   *
   * Часы в таблице разбросаны на два порядка: 2400 у Dota и 12 у Portal 2.
   * При прямой пропорции всё, кроме первой строки, превращается в нить в
   * четыре пикселя — шкала перестаёт что-либо показывать ровно там, где её
   * начали читать. Проверено на живых числах: Terraria со 130 часами давала
   * 0.054 длины.
   *
   * Корень — обычная перцептивная поправка для длин: порядок строк он
   * сохраняет полностью (кто больше, тот и длиннее), а разрыв между гигантом и
   * середняком сжимает до различимого. Точные часы всё равно напечатаны рядом
   * цифрами — шкала отвечает за «кто кого», числа за «насколько».
   *
   * Нижний упор — чтобы самая маленькая доля осталась видимым огрызком, а не
   * исчезла совсем: пустое место на шкале читается как «данных нет», а данные
   * есть.
   */
  const bar = (v: number) => Math.max(0.07, Math.sqrt(Math.max(0, v) / peak))

  return (
    <Stage
      id="compat"
      label="Совместимость и пати"
      end="+=110%"
      enter={(intro, root) => {
        /*
         * ПОДЪЁЗД К СТОЛКНОВЕНИЮ.
         *
         * Кадр сцены ставится на подъёме: две библиотеки съезжаются к центру
         * ещё до закрепления, иначе целый экран прокрутки показывает пустоту.
         *
         * Половины приезжают ИЗ-ЗА КРАЯ и доворачиваются: наклон тоже едет,
         * от почти плоского к встречному. Съезд без доворота читался тем, чем
         * и был, — двумя блоками, которые подвинули; с доворотом это две
         * стопки, которые кладут навстречу друг другу.
         *
         * Шов тушится здесь же: гореть ему пока не над чем, библиотеки ещё не
         * встретились. Зажигается он в build, на кульминации.
         */
        const a = root.querySelector('[data-stack="a"]')
        const b = root.querySelector('[data-stack="b"]')
        const seam = root.querySelector('[data-compat-seam]')
        gsap.set(a, { xPercent: -46, autoAlpha: 0, rotate: -1 })
        gsap.set(b, { xPercent: 46, autoAlpha: 0, rotate: 1 })
        gsap.set(seam, { autoAlpha: 0, scaleY: 0.55 })
        intro
          .to(a, { xPercent: 0, autoAlpha: 1, rotate: -7, duration: 0.7, ease: 'power3.out' }, 0)
          .to(b, { xPercent: 0, autoAlpha: 1, rotate: 7, duration: 0.7, ease: 'power3.out' }, 0.04)
      }}
      build={(tl, root) => {
        const rows = root.querySelectorAll('[data-compat-row]')
        const counters = root.querySelectorAll<HTMLElement>('[data-count]')
        const fills = root.querySelectorAll('.compat-fill')
        const seam = root.querySelector('[data-compat-seam]')
        const tally = root.querySelectorAll('[data-tally]')

        gsap.set(rows, { autoAlpha: 0, y: 18 })
        gsap.set(fills, { scaleX: 0 })
        gsap.set(tally, { autoAlpha: 0, y: 14 })

        /**
         * Куда доехать шкале — берётся у неё самой.
         *
         * Тянуть их все в scaleX: 1 нельзя, и это уже было сделано: доля живёт
         * в --k, а твин в единицу приводил ВСЕ шкалы к полной длине. Кадр
         * выглядел исправным — восемь строк, у каждой обе половины залиты, —
         * и врал: Dota с 2400 против 50 показывала две одинаковые полоски.
         * Ровно тот вид, ради опровержения которого таблицу и переделывали.
         */
        const goal = (_i: number, el: Element) =>
          Number((el as HTMLElement).style.getPropertyValue('--k')) || 0

        /*
         * ПАРТИТУРА С ОДНОЙ КУЛЬМИНАЦИЕЙ, А НЕ «ВСЁ ВЫЕХАЛО СНИЗУ».
         *
         * Такт 0 — вспышка шва: библиотеки сошлись, и первым появляется то, что
         * у них общего. Всё остальное — следствие этой вспышки и приходит
         * ПОСЛЕ неё: сначала итог (два числа под швом), потом строки, и только
         * потом весы разъезжаются по сторонам.
         *
         * Весы едут дольше всех и с волной: 0.05 с между соседними строками
         * даёт видимый прокат сверху вниз, а не одновременный щелчок восьми
         * шкал.
         *
         * scaleX/scaleY и opacity — композитор, ничего не пересобирает.
         */
        // Счётчики добавляются ПЕРВЫМИ, хотя играют не первыми: порядок
        // добавления в таймлайн больше ни на что не влияет (см. tl.duration()
        // в Stage.tsx), но читать партитуру проще, когда самая длинная волна
        // стоит в конце цепочки и последней же заканчивается.
        counters.forEach((node) => {
          const target = Number(node.dataset.count ?? 0)
          const box = { v: 0 }
          // Обнуление живёт ЗДЕСЬ, а не в разметке: в build не заходят при
          // «уменьшить движение», и там число остаётся настоящим.
          node.textContent = '0'
          tl.to(
            box,
            {
              v: target,
              duration: 0.6,
              ease: 'power1.out',
              onUpdate: () => {
                node.textContent = Math.round(box.v).toLocaleString('ru-RU')
              },
            },
            0.16,
          )
        })

        tl.to(seam, { autoAlpha: 1, scaleY: 1, duration: 0.35, ease: 'power2.out' }, 0)
          .to(tally, { autoAlpha: 1, y: 0, stagger: 0.07, duration: 0.3, ease: 'power2.out' }, 0.12)
          .to(rows, { autoAlpha: 1, y: 0, stagger: 0.045, duration: 0.28, ease: 'power2.out' }, 0.2)
          .to(fills, { scaleX: goal, stagger: 0.035, duration: 0.5, ease: 'power2.out' }, 0.34)
      }}
    >
      <p className="slate">
        <b>04</b>
        <span>Совместимость и пати</span>
      </p>

      <div className="compat-grid">
        <div className="min-w-0">
          <h2 className="font-display text-display-md" style={{ maxWidth: '21ch' }}>
            Сравним библиотеки по-настоящему, а не по анкете
          </h2>

          <div className="stacks">
            <div className="stack" data-stack="a">
              {left.map((g) => (
                <GameArt
                  key={`a-${g.appid}`}
                  appid={g.appid}
                  name={g.name}
                  headerImage={g.headerImage}
                  art={g.art}
                  /* Замерено: обложка в стопке — 76 px на телефоне. */
                  sizes="(max-width: 899px) 80px, 120px"
                />
              ))}
            </div>
            <div className="stack" data-stack="b">
              {right.map((g) => (
                <GameArt
                  key={`b-${g.appid}`}
                  appid={g.appid}
                  name={g.name}
                  headerImage={g.headerImage}
                  art={g.art}
                  /* Замерено: обложка в стопке — 76 px на телефоне. */
                  sizes="(max-width: 899px) 80px, 120px"
                />
              ))}
            </div>

            {/* Шов на линии встречи. Кульминация сцены: библиотеки сошлись —
                и первым появляется то, что у них общего. */}
            <span aria-hidden className="compat-seam" data-compat-seam />
          </div>

          {/*
            В РАЗМЕТКЕ СТОИТ НАСТОЯЩЕЕ ЧИСЛО, А НЕ НОЛЬ.

            Здесь был ноль, и это ломало ровно то правило, ради которого в
            проекте запрещён fill-mode: анимация может добавить появление, но не
            может быть условием того, что содержимое верно. Ноль в разметке
            означал, что при «уменьшить движение» и без скрипта сцена печатала
            «0 общих игр, 0 часов на двоих» — то есть не пустоту, что было бы
            полбеды, а ПРЯМУЮ НЕПРАВДУ, и как раз в той сцене, которая отдельным
            абзацем отказывается показывать красивую неправду про проценты.

            Обнуляет их теперь build — то есть только там, где твин точно
            пойдёт и точно допишет число обратно.
          */}
          <div className="tally">
            <div data-tally>
              <div className="tally-n" data-count={shared}>
                {shared.toLocaleString('ru-RU')}
              </div>
              <div className="tally-l">общих игр</div>
            </div>
            <div data-tally>
              <div className="tally-n" data-count={compat.hours}>
                {compat.hours.toLocaleString('ru-RU')}
              </div>
              <div className="tally-l">часов на двоих</div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <Eyebrow tone="faint" className="mb-3">
            Что нашлось у обоих
          </Eyebrow>
          <ul className="compat-rows">
            {compat.rows.map((r) => (
              <li key={r.name} className="compat-row" data-compat-row>
                <span className="compat-name">{r.name}</span>
                <span className="compat-a">{r.a.toLocaleString('ru-RU')}</span>
                {/*
                  Весы. Доли считаются от самого большого часа во ВСЕЙ таблице,
                  а не внутри строки: иначе у каждой игры своя шкала, и Portal 2
                  с двенадцатью часами выглядел бы так же весомо, как Dota с
                  двумя тысячами. Сравнивать строки между собой — половина
                  смысла этой таблицы.
                */}
                <span aria-hidden className="compat-bar">
                  <span className="compat-track compat-track-a">
                    <span className="compat-fill" style={{ '--k': bar(r.a) } as CSSProperties} />
                  </span>
                  <span className="compat-track compat-track-b">
                    <span className="compat-fill" style={{ '--k': bar(r.b) } as CSSProperties} />
                  </span>
                </span>
                <span className="compat-b">{r.b.toLocaleString('ru-RU')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-md text-xs leading-relaxed text-faint">
            Процент совпадения вкусов мы тут не показываем: он считается по редкости тегов во всём
            каталоге, а не по этой паре, — на демо он был бы красивым и неправдой.
          </p>
        </div>
      </div>
    </Stage>
  )
}
