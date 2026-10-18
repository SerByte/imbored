import Link from '@/components/Link'
import { tr, type Locale } from '@/lib/i18n'
import { navPrefetch } from '@/lib/nav'
import { LocaleSwitch } from './LocaleSwitch'
import { LogoMark } from './Logo'
import { Wordmark } from './Wordmark'

/**
 * Подвал — серверный: язык приходит пропсом из корневого layout, ссылки
 * ставят префикс сами (components/Link).
 *
 * Переключатель языка — здесь, последним в ряду ссылок, а не в шапке и не
 * в нижней панели: их ширины замерены по русским подписям впритык
 * (components/HeaderNav, MobileNav), а ряд подвала переносится сам
 * (flex-wrap) и лишнего места ни у кого не отнимает.
 */
export function Footer({ locale = 'ru' }: { locale?: Locale }) {
  return (
    <footer className="relative mt-auto border-t border-edge">
      <div className="mx-auto max-w-6xl px-safe py-6 flex items-center justify-between gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-2.5 text-faint">
          <LogoMark size={22} />
          <Wordmark className="text-[17px]" />
          <span className="text-[13px] font-semibold">
            {`· ${tr(locale, { ru: 'во что поиграть сегодня', en: 'what to play tonight' })}`}
          </span>
        </div>
        {/* Имя — чтобы в списке ориентиров это не было третьей безымянной
            «навигацией» рядом с меню разделов */}
        <nav aria-label={tr(locale, { ru: 'Служебные ссылки', en: 'Site links' })} className="flex items-center flex-wrap gap-x-6 gap-y-2 text-[13px] font-semibold text-dim">
          {/* Хаб жанров — единственная ссылка отсюда, открытая гостю и
              краулеру: остальные разделы шапки и панели живут за входом.
              Страница на ISR, префетч с края ей ничего не стоит. */}
          <Link href="/games" className="tap tap-tight hover:text-ink transition-colors">
            {tr(locale, { ru: 'Игры по жанрам', en: 'Games by genre' })}
          </Link>
          <Link href="/support" className="tap tap-tight hover:text-ink transition-colors">
            {tr(locale, { ru: 'Поддержать проект', en: 'Support the project' })}
          </Link>
          {/* Портрет и совместимость собираются на каждый запрос: префетч из
              подвала будил бы функцию на каждом просмотре любой страницы
              (подробно — lib/nav, DYNAMIC_SECTIONS) */}
          <Link
            href="/portrait"
            prefetch={navPrefetch('/portrait')}
            className="tap tap-tight hover:text-ink transition-colors"
          >
            {tr(locale, { ru: 'Портрет игрока', en: 'Player portrait' })}
          </Link>
          <Link
            href="/compat"
            prefetch={navPrefetch('/compat')}
            className="tap tap-tight hover:text-ink transition-colors"
          >
            {tr(locale, { ru: 'Совместимость', en: 'Compatibility' })}
          </Link>
          <Link href="/privacy" className="tap tap-tight hover:text-ink transition-colors">
            {tr(locale, { ru: 'Конфиденциальность', en: 'Privacy' })}
          </Link>
          <LocaleSwitch />
        </nav>
      </div>
    </footer>
  )
}
