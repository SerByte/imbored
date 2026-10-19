import { Icon } from '@/components/Icon'
import { MoneyStage } from '@/components/landing/scenes/MoneyStage'
import { tr, type Locale } from '@/lib/i18n'

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
 *
 * Компонент серверный: разметку и текст рисует сервер, а партитура (gsap)
 * живёт в клиентском MoneyStage и находит блоки по data-атрибутам. Язык —
 * пропом от главной: контекст LocaleProvider серверу не прочитать.
 */
export function Money({ locale }: { locale: Locale }) {
  return (
    <MoneyStage label={tr(locale, { ru: 'О деньгах и возврат', en: 'About money, and back to the top' })}>
      {/* Сиденье под текстом и тёплый разлив под возвратом: лента здесь на
          полной яркости, и белое по обложке иначе читается через раз. */}
      <div className="money-glow" aria-hidden />

      <p className="slate">
        <b>06</b>
        <span>{tr(locale, { ru: 'О деньгах', en: 'About money' })}</span>
      </p>

      {/*
        Ударение на тезисе, а не на всей фразе. Заголовок держал четыре строки
        ровным белым, и главное в нём — «доверие не продаётся» — весило столько
        же, сколько служебное «Мы не продаём места в выдаче».

        Неразрывные пробелы — после «в», «а», «И» и перед тире: на телефоне
        заголовок ломался «места в / выдаче», «Рекомендация / — это доверие, а /
        доверие», и строка то кончалась предлогом, то начиналась с тире.
      */}
      {/*
        По-английски — та же фраза, что на /support (глоссарий): ударение — на
        «and trust isn’t for sale». Неразрывные пробелы — по той же причине,
        что в русском: на любой ширине телефона строка кончалась артиклем
        («…in our picks. A / recommendation»), а «for sale» держится вместе.
      */}
      {locale === 'en' ? (
        <h2 className="font-display text-display-md text-balance" style={{ maxWidth: '20ch' }} data-money-line>
          We don’t sell spots in our picks. A&nbsp;recommendation is trust,{' '}
          <span className="text-ember-text">and trust isn’t for&nbsp;sale</span>.
        </h2>
      ) : (
        <h2 className="font-display text-display-md text-balance" style={{ maxWidth: '20ch' }} data-money-line>
          Мы не продаём места в&nbsp;выдаче. Рекомендация&nbsp;— это доверие,{' '}
          <span className="text-ember-text">а&nbsp;доверие не продаётся</span>.
        </h2>
      )}

      {locale === 'en' ? (
        <ul className="money-list">
          <li data-money-item>No ads in the picks.</li>
          <li data-money-item>imbored is free. And it’ll stay that&nbsp;way.</li>
          <li data-money-item>A sale nudges a pick; it doesn’t sort the list.</li>
        </ul>
      ) : (
        <ul className="money-list">
          <li data-money-item>Рекламы в подборе нет.</li>
          <li data-money-item>imbored бесплатен. И&nbsp;останется таким.</li>
          <li data-money-item>Скидка — наклон, а не сортировка.</li>
        </ul>
      )}

      <div className="back-block" data-money-back>
        <div className="max-w-md">
          {/* По-английски «yours» в заголовке не на что указать — русское «твою»
              держит библиотеку родом, — поэтому библиотека названа словом
              глоссария, и «Rather not share yours?» ниже читается про неё же */}
          <h3 className="font-display text-display-sm">
            {tr(locale, { ru: 'Подключим твою?', en: 'Connect your library?' })}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-dim">
            {tr(locale, {
              ru: 'Дальше — пара тапов и одна игра. Не хочешь отдавать свою — на первом экране есть демо без Steam.',
              en: 'From here it’s a couple of taps and one game. Rather not share yours? There’s a demo without Steam up top.',
            })}
          </p>
        </div>
        <a className="btn-ember back-btn" href="#main">
          {tr(locale, { ru: 'Наверх, к подключению ', en: 'Back to the top ' })}
          <Icon name="up" size={18} />
        </a>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-faint">
        {tr(locale, {
          ru: 'imbored — независимый проект, не связанный с Valve Corporation. Steam и логотип Steam — товарные знаки Valve Corporation.',
          en: 'imbored is an independent project and is not affiliated with Valve Corporation. Steam and the Steam logo are trademarks of Valve Corporation.',
        })}
      </p>
    </MoneyStage>
  )
}
