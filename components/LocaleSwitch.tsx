'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Fragment, Suspense } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE_SEC, LOCALES, switchLocaleHref, tr, type Locale } from '@/lib/i18n'

/**
 * Переключатель «RU / EN»: тот же адрес на другом языке (docs/i18n.md).
 *
 * Две ссылки, а не кнопка: у каждой версии свой адрес, и его можно открыть
 * в новой вкладке, скопировать и отдать краулеру. Текущая помечена
 * aria-current, у другой — hrefLang; lang — у обеих, чтобы скринридер прочёл
 * «English» по-английски, а не русским голосом.
 *
 * Обычные <a>, а не components/Link, и это не забыто. Link ставит префикс
 * языка ТЕКУЩЕЙ страницы: на /en ссылка на русский '/play' превратилась бы
 * обратно в '/en/play'. А переход на другой язык — полная загрузка: меняется
 * корневой layout (<html lang>), и всё, что клиент закэшировал по-русски,
 * начинает заново.
 *
 * Нажатие пишет куку lang: явный выбор человека важнее языка браузера, и
 * правила «/» в next.config ведут по ней, а не по Accept-Language
 * (lib/homelocale.ts). Год, Lax, на весь сайт.
 *
 * Строка запроса едет с адресом — с выдачи /play?time=… человек попадает на
 * ту же выдачу на другом языке. useSearchParams на статической странице
 * требует границы Suspense, иначе главная перестала бы пререндериться
 * (bundle-budget.json, static): до гидратации ссылки ведут на адрес без
 * запроса, после — с ним.
 */

const NAME: Record<Locale, string> = { ru: 'Русский', en: 'English' }
const SHORT: Record<Locale, string> = { ru: 'RU', en: 'EN' }

/**
 * Запомнить выбор: кука, которую читают правила «/» в next.config. doc — ради теста.
 * Зовёт и лендинг после входа с английской версии (components/landing/ConnectCard).
 */
export function rememberLocale(target: Locale, doc: { cookie: string } = document): void {
  try {
    doc.cookie = `${LANG_COOKIE}=${target}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE_SEC}; SameSite=Lax`
  } catch {
    // куки запрещены — переход всё равно случится, просто без памяти
  }
}

function Links({ search }: { search: string }) {
  const locale = useLocale()
  const pathname = usePathname() ?? '/'
  return (
    <span role="group" aria-label={tr(locale, { ru: 'Язык', en: 'Language' })} className="flex items-center gap-1.5">
      {LOCALES.map((target, i) => {
        const current = target === locale
        return (
          <Fragment key={target}>
            {i > 0 && (
              <span aria-hidden className="text-faint">
                /
              </span>
            )}
            <a
              href={switchLocaleHref(pathname, target, search)}
              aria-current={current ? 'true' : undefined}
              hrefLang={current ? undefined : target}
              lang={target}
              title={NAME[target]}
              onClick={() => rememberLocale(target)}
              className={`tap tap-tight transition-colors ${current ? 'text-ink' : 'hover:text-ink'}`}
            >
              {/* Полное имя — скринридеру, рядом с видимым «RU»: имя ссылки
                  обязано содержать то, что написано на ней (WCAG 2.5.3), —
                  «нажми RU» голосом иначе не сработает */}
              {SHORT[target]}
              <span className="sr-only"> {NAME[target]}</span>
            </a>
          </Fragment>
        )
      })}
    </span>
  )
}

/**
 * Шапочный вариант: одна кнопка — на ДРУГОЙ язык («EN» на русской странице,
 * «RU» на английской). В подвале переключатель есть всегда, но подвал —
 * последнее, до чего доходит взгляд, а английский гость, попавший по ссылке
 * на русскую страницу, ищет язык наверху.
 *
 * Видна на телефоне и с xl (1280). На телефоне место есть: пункты меню уехали
 * в нижнюю панель, в шапке остались логотип, поиск и тема (замер: от логотипа
 * до кнопок 53–54 px на 360). На md (768–1023) шапка замерена до пикселя, и
 * запаса нет даже на значок поиска (components/HeaderNav.tsx). На lg кнопка
 * встала, но русская строка подошла к логотипу на 11 px при 1024 — меньше
 * полосы прокрутки десктопного окна (15), то есть меню наехало бы на логотип.
 * С xl зазор 139 px. На 768–1279 язык — в подвале.
 *
 * Видимое «EN» и полное «English» для скринридера — то же правило, что у
 * пары в подвале: имя ссылки содержит написанное на ней (WCAG 2.5.3).
 */
function Other({ search }: { search: string }) {
  const locale = useLocale()
  const pathname = usePathname() ?? '/'
  const target: Locale = locale === 'ru' ? 'en' : 'ru'
  return (
    <a
      href={switchLocaleHref(pathname, target, search)}
      hrefLang={target}
      lang={target}
      title={NAME[target]}
      onClick={() => rememberLocale(target)}
      className="tap btn-glass h-10 min-w-10 !rounded-full !px-3 !py-0 inline-flex items-center justify-center text-[13px] font-semibold text-dim hover:text-ink transition-colors md:max-xl:hidden"
    >
      {SHORT[target]}
      <span className="sr-only"> {NAME[target]}</span>
    </a>
  )
}

function WithQuery({ compact }: { compact: boolean }) {
  const search = useSearchParams()
  const q = search?.toString() ?? ''
  return compact ? <Other search={q} /> : <Links search={q} />
}

export function LocaleSwitch({ compact = false }: { compact?: boolean } = {}) {
  return (
    <Suspense fallback={compact ? <Other search="" /> : <Links search="" />}>
      <WithQuery compact={compact} />
    </Suspense>
  )
}
