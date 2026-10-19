import type { CSSProperties } from 'react'
import { GameArt } from '@/components/GameArt'
import { Eyebrow } from '@/components/Labels'
import { CompatStage } from '@/components/landing/scenes/CompatStage'
import { fmtNumber, tr, type Locale } from '@/lib/i18n'
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
 *
 * Язык — пропом от главной, тем же, на каком собрана демо-выдача (landingDemo
 * считается на сервере под язык страницы): числа и подписи сцены обязаны
 * говорить с ней на одном языке. Без пропа — русский.
 *
 * Компонент серверный: стопки, итог и таблица рисуются на сервере, а
 * партитура (gsap) живёт в клиентском CompatStage. Демо-выдачу она берёт из
 * разметки — data-count у счётчиков и --k у шкал, — так что в клиент едут
 * только язык и колбэки, а не демо и подписи обоих языков.
 */
export function Compat({ demo, locale = 'ru' }: { demo: LandingDemo; locale?: Locale }) {
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
    <CompatStage
      label={tr(locale, { ru: 'Совместимость и пати', en: 'Compatibility and parties' })}
      locale={locale}
    >
      <p className="slate">
        <b>04</b>
        <span>{tr(locale, { ru: 'Совместимость и пати', en: 'Compatibility and parties' })}</span>
      </p>

      <div className="compat-grid">
        <div className="min-w-0">
          {/* «по-настоящему» одним куском: браузер рвал его на дефисе, и
              строка кончалась на «по-» */}
          {locale === 'en' ? (
            <h2 className="font-display text-display-md text-balance" style={{ maxWidth: '21ch' }}>
              A real comparison of your libraries, not a&nbsp;quiz
            </h2>
          ) : (
            <h2 className="font-display text-display-md text-balance" style={{ maxWidth: '21ch' }}>
              Сравним библиотеки <span className="whitespace-nowrap">по-настоящему</span>, а&nbsp;не по анкете
            </h2>
          )}

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
                {fmtNumber(locale, shared)}
              </div>
              <div className="tally-l">{tr(locale, { ru: 'общих игр', en: 'games in common' })}</div>
            </div>
            <div data-tally>
              <div className="tally-n" data-count={compat.hours}>
                {fmtNumber(locale, compat.hours)}
              </div>
              <div className="tally-l">{tr(locale, { ru: 'часов на двоих', en: 'hours between you' })}</div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <Eyebrow tone="faint" className="mb-3">
            {tr(locale, { ru: 'Что нашлось у обоих', en: 'What you both have' })}
          </Eyebrow>
          <ul className="compat-rows">
            {compat.rows.map((r) => (
              <li key={r.name} className="compat-row" data-compat-row>
                <span className="compat-name">{r.name}</span>
                <span className="compat-a">{fmtNumber(locale, r.a)}</span>
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
                <span className="compat-b">{fmtNumber(locale, r.b)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-md text-xs leading-relaxed text-faint">
            {tr(locale, {
              ru: 'Процент совпадения вкусов мы тут не показываем: он считается по редкости тегов во всём каталоге, а не по этой паре, — на демо он был бы красивым и неправдой.',
              en: 'We don’t show a taste match percentage here: it’s based on how rare tags are across the whole catalog, not on this pair — on a demo it would look nice and be wrong.',
            })}
          </p>
        </div>
      </div>
    </CompatStage>
  )
}
