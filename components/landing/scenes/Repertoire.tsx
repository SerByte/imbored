import Link from '@/components/Link'
import { Icon, type IconName } from '@/components/Icon'
import { RepertoireStage } from '@/components/landing/scenes/RepertoireStage'
import { LinkPending } from '@/components/LinkPending'
import { PosterFan, type FanGame } from '@/components/PosterFan'
import { tr, type Locale } from '@/lib/i18n'
import { navPrefetch } from '@/lib/nav'

/**
 * СЦЕНА 5: ЧТО ЗДЕСЬ ЕЩЁ ЕСТЬ.
 *
 * Полкой разделов, как «категории» у стриминга: шесть карточек, у каждой свой
 * веер постеров. Это единственная сцена, которая одновременно и рассказ, и
 * навигация — ссылки живые, и человек может уйти в раздел прямо отсюда.
 *
 * Раньше здесь было расписание: шесть строк текста между волосками. Раздел
 * читался названием, но не показывал, ЧТО в нём лежит, — а у этого сайта всё
 * про игры, и молчать о них в оглавлении было странно.
 *
 * ПОСТЕРЫ — ИЗ ЗАШИТОГО СПИСКА ЛЕНТЫ (lib/ribbon.ts, FALLBACK_RIBBON), и это
 * намеренно: у гостя без каталога лента уже скачала ровно эти файлы, и полка
 * достаётся из кэша даром. Страница статическая, поэтому номера игр зашиты,
 * а не приходят из базы. Подбор по смыслу раздела: кооп для пати, два
 * соревновательных хита для совместимости, одна игра для «игры дня».
 *
 * Строки короткие: в кино-сцене абзац на карточку не читается — его
 * проматывают.
 *
 * ПРЕФЕТЧ — ПО ПРАВИЛУ ОБВЯЗКИ (lib/nav, DYNAMIC_SECTIONS). Четыре карточки
 * из шести ведут в разделы, которые собираются на каждый запрос, и Next
 * префетчит ссылку, как только она входит в экран: каждый, кто докрутил
 * главную до этой сцены, будил функции /compat, /library, /portrait и
 * /whatsnew — гостю ради редиректов на вход, по которым он не пойдёт.
 * Пауза перехода без префетча видна: название раздела мерцает, пока едет
 * сервер (LinkPending), как в шапке и нижней панели. Сторож —
 * lib/navprefetch.test.ts.
 *
 * КОМПОНЕНТ СЕРВЕРНЫЙ. Таблица разделов на обоих языках и разметка полки
 * остаются на сервере; клиентские здесь только ссылка (Link, LinkPending),
 * обложки (GameArt внутри PosterFan) и партитура в RepertoireStage. Язык —
 * пропом от главной: контекст LocaleProvider серверу не прочитать.
 */

/*
 * Имена разделов — те же, что в навигации (глоссарий docs/i18n.md): человек
 * узнаёт их здесь и в шапке одними словами. Строки — парой языков рядом.
 */
type Section = {
  href: string
  name: Record<Locale, string>
  line: Record<Locale, string>
  icon: IconName
  art: readonly FanGame[]
}

const REPERTOIRE: readonly Section[] = [
  {
    href: '/rooms',
    name: { ru: 'Пати', en: 'Party' },
    line: { ru: 'Комната, ссылка своим, свайпаете вместе.', en: 'A room, a link for your friends, and you swipe together.' },
    icon: 'users',
    art: [
      { appid: 548430, name: 'Deep Rock Galactic' },
      { appid: 892970, name: 'Valheim' },
      { appid: 105600, name: 'Terraria' },
    ],
  },
  {
    href: '/compat',
    name: { ru: 'Совместимость', en: 'Compatibility' },
    line: { ru: 'Сравним библиотеки и часы с кем угодно.', en: 'Compare libraries and hours with anyone.' },
    icon: 'heart',
    art: [
      { appid: 570, name: 'Dota 2' },
      { appid: 730, name: 'Counter-Strike 2' },
    ],
  },
  {
    href: '/daily',
    name: { ru: 'Игра дня', en: 'Game of the day' },
    line: { ru: 'Одна игра на день. Завтра будет другая.', en: 'One game a day. Tomorrow brings another.' },
    icon: 'calendar',
    art: [{ appid: 1145360, name: 'Hades' }],
  },
  {
    href: '/library',
    name: { ru: 'Библиотека', en: 'Library' },
    line: { ru: 'Заброшенное и нераспакованное — одной стеной.', en: 'Abandoned and unopened games — on one wall.' },
    icon: 'grid',
    art: [
      { appid: 413150, name: 'Stardew Valley' },
      { appid: 367520, name: 'Hollow Knight' },
      { appid: 504230, name: 'Celeste' },
    ],
  },
  {
    href: '/portrait',
    name: { ru: 'Портрет игрока', en: 'Player portrait' },
    line: { ru: 'Куда ушло время — страницей, которой делятся.', en: 'Where your time went — a page worth sharing.' },
    icon: 'spark',
    art: [
      { appid: 632470, name: 'Disco Elysium' },
      { appid: 292030, name: 'The Witcher 3' },
    ],
  },
  {
    href: '/whatsnew',
    name: { ru: 'Что нового', en: 'What’s new' },
    line: { ru: 'Только крупные патчи по твоим играм.', en: 'Only major patches for your games.' },
    icon: 'news',
    art: [
      { appid: 1091500, name: 'Cyberpunk 2077' },
      { appid: 1086940, name: "Baldur's Gate 3" },
    ],
  },
]

export function Repertoire({ locale }: { locale: Locale }) {
  const slate = tr(locale, { ru: 'Что здесь ещё есть', en: 'What else is here' })
  return (
    <RepertoireStage label={slate}>
      <div className="rep-glow" aria-hidden />

      <p className="slate">
        <b>05</b>
        <span>{slate}</span>
      </p>

      <ul className="rep">
        {REPERTOIRE.map((item) => (
          <li key={item.href} data-rep-row>
            <Link href={item.href} prefetch={navPrefetch(item.href)} className="rep-card fan-host">
              <PosterFan games={item.art} />
              <span aria-hidden className="rep-icon">
                <Icon name={item.icon} size={18} />
              </span>
              <span className="rep-name">
                <LinkPending>{item.name[locale]}</LinkPending>
              </span>
              <span className="rep-line">{item.line[locale]}</span>
              <span aria-hidden className="rep-arrow">
                <Icon name="arrow" size={18} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </RepertoireStage>
  )
}
