'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { clientErrorCode, isChunkLoadError, reportClientError } from '@/lib/clienterr'
import { htmlLang, lp, splitLocale, tr, type Locale } from '@/lib/i18n'
import {
  BG,
  DIM,
  EMBER,
  INK,
  LIGHT_BG,
  LIGHT_DIM,
  LIGHT_EMBER,
  LIGHT_INK,
  PLATE,
} from '@/lib/palette'

/**
 * Последний экран, на котором продукт ещё говорит своим языком.
 *
 * app/error.tsx ловит исключения страниц — но НЕ ловит их в корневом layout и
 * template над собой (docs/error.md, «It does not wrap the layout.js or
 * template.js above it»). То есть ровно та проблема, ради которой заводился
 * error.tsx — «стоковый экран Next без шапки, без языка продукта, без
 * выхода», — оставалась в силе одним уровнем выше и до сих пор не была закрыта.
 *
 * Ограничения этого файла не наши, а платформенные, и объясняют тут всё:
 *
 * 1. Он ЗАМЕНЯЕТ корневой layout, поэтому обязан отдать свои <html> и <body>.
 * 2. Он рендерится БЕЗ глобальных стилей. Значит ни Tailwind, ни токенов
 *    палитры, ни next/font: всё оформление — инлайном и системными
 *    начертаниями. Числа берутся из lib/palette.ts, чтобы цвет аварии был тем
 *    же цветом бренда, а не «примерно похожим».
 * 3. metadata из него не экспортируется — заголовок вкладки ставится
 *    компонентом <title> прямо в разметке.
 * 4. Переключатель темы сюда не доезжает (он ставит data-theme, а стилей,
 *    которые бы его читали, здесь нет). Поэтому тему берём у системы через
 *    prefers-color-scheme в собственном <style>: это единственный способ не
 *    ударить светлого человека чёрным листом.
 *
 * retry, а не reset: на серверной ошибке reset перерисовывает детей БЕЗ
 * повторного запроса, то есть из того же payload, который только что упал.
 * Кнопка выглядела бы нажатой и не сделала бы ничего.
 *
 * Не пришёл кусок кода — кнопка перезагружает страницу, а не повторяет:
 * повтор перерисует тот же lazy, который помнит отказ (подробно — в
 * app/error.tsx и у isChunkLoadError в lib/clienterr).
 *
 * Код и отчёт — как в app/error.tsx: у клиентской ошибки digest нет, код
 * считается из неё самой и уходит в /api/clienterr. lib/clienterr — чистый
 * модуль без стилей и без React, упасть второй раз ему не на чем.
 */
/*
 * Язык — из адреса в браузере, а не из сегмента [lang]: global-error стоит
 * ВМЕСТО корневого layout, и ни LocaleProvider, ни next/root-params здесь
 * нет. Сервер (рендер упавшего layout) отдаёт русский, браузер после
 * гидратации берёт язык из location.pathname — так разметка совпадает, а
 * /en/… переходит на английский сразу после неё. lib/i18n — чистый модуль
 * без стилей и без React, как lib/clienterr: упасть второй раз ему не на чем.
 */
const noSubscribe = () => () => {}
const browserLocale = (): Locale => splitLocale(window.location.pathname ?? '/').locale
const serverLocale = (): Locale => 'ru'

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const code = error.digest ?? clientErrorCode(error)
  const stale = isChunkLoadError(error)
  const locale = useSyncExternalStore(noSubscribe, browserLocale, serverLocale)

  useEffect(() => {
    if (!error.digest) {
      reportClientError({ kind: 'boundary', error, href: window.location.href, code })
    }
  }, [error, code])

  return (
    <html lang={htmlLang(locale)}>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: BG,
          color: INK,
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <title>{tr(locale, { ru: 'Что-то сломалось · imbored', en: 'Something broke · imbored' })}</title>
        <style>{`
          :root { color-scheme: dark }
          @media (prefers-color-scheme: light) {
            :root { color-scheme: light }
            body { background: ${LIGHT_BG} !important; color: ${LIGHT_INK} !important }
            .ge-dim { color: ${LIGHT_DIM} !important }
            /* Заливка и текст на ней меняются ПАРОЙ — точно так же, как --ember и
               --on-ember в globals.css: на тёмном главная кнопка белая, на
               молочном — чёрная с белым текстом. */
            .ge-btn { background: ${LIGHT_EMBER} !important; color: ${LIGHT_BG} !important }
            .ge-plate { fill: ${LIGHT_INK} !important }
            .ge-glyph { fill: ${LIGHT_BG} !important; stroke: ${LIGHT_BG} !important }
            /* Кольцо фокуса — третий потребитель --ember, как в globals.css.
               Оно стоит с отступом, то есть на фоне страницы, а не на кнопке:
               белое на молочном давало ~1.08:1, и фокуса с клавиатуры не было
               видно вовсе. !important — базовое правило ниже по тексту. */
            .ge-btn:focus-visible, .ge-link:focus-visible { outline-color: ${LIGHT_EMBER} !important }
          }
          .ge-btn { transition: opacity .15s ease }
          .ge-btn:hover { opacity: .88 }
          .ge-btn:focus-visible, .ge-link:focus-visible { outline: 2px solid ${EMBER}; outline-offset: 2px }
        `}</style>

        <main
          style={{
            width: '100%',
            maxWidth: '26rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
            textAlign: 'center',
          }}
        >
          {/* Знак нарисован здесь, а не взят из components/Logo: тот компонент
              красится теми же литералами, но тянуть в аварийный экран лишний
              модуль — лишний способ упасть второй раз. */}
          <svg width="48" height="48" viewBox="0 0 64 64" aria-hidden>
            <rect className="ge-plate" width="64" height="64" rx="18" fill={PLATE} />
            <circle className="ge-glyph" cx="22" cy="24.5" r="6" fill={BG} />
            <circle className="ge-glyph" cx="22" cy="42" r="6" fill={BG} />
            <line className="ge-glyph" x1="36" y1="20" x2="46" y2="45" stroke={BG} strokeWidth="9" strokeLinecap="round" />
          </svg>

          <h1 style={{ margin: 0, fontSize: '26px', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            {tr(locale, { ru: 'Что-то сломалось целиком', en: 'Everything broke at once' })}
          </h1>

          <p className="ge-dim" style={{ margin: 0, fontSize: '15px', lineHeight: 1.6, color: DIM }}>
            {tr(locale, {
              ru: 'Упало не на странице, а во всём приложении сразу. Скорее всего, это на нашей стороне и уже чинится — попробуй ещё раз.',
              en: 'Not just this page — the whole app went down. It’s most likely on our end and already being fixed. Try again.',
            })}
          </p>

          <button
            type="button"
            onClick={() => (stale ? window.location.reload() : retry())}
            className="ge-btn"
            style={{
              width: '100%',
              border: 0,
              borderRadius: '11px',
              background: EMBER,
              color: BG,
              font: 'inherit',
              fontWeight: 700,
              fontSize: '15px',
              padding: '13px 20px',
              cursor: 'pointer',
            }}
          >
            {stale
              ? tr(locale, { ru: 'Обновить страницу', en: 'Reload the page' })
              : tr(locale, { ru: 'Попробовать снова', en: 'Try again' })}
          </button>

          {/*
            Обычная <a>, а не <Link>. <Link> делает клиентский переход, то есть
            оставляет жить то самое дерево React, которое только что развалилось
            целиком. Полная перезагрузка тут не издержка, а смысл: корневой layout
            отрабатывает заново. Главная — на языке адреса (/ или /en); адрес
            выражением, и no-html-link-for-pages его не проверяет — исключение
            для правила больше не нужно.
          */}
          <a
            href={lp(locale, '/')}
            className="ge-link ge-dim"
            style={{ color: DIM, fontSize: '14px', textDecoration: 'none' }}
          >
            {tr(locale, { ru: 'На главную', en: 'Home' })}
          </a>

          {/* Код нужен не человеку, а нам: по нему ошибка находится в логах.
              Поэтому он тихий и стоит последним. */}
          <span
            className="ge-dim"
            style={{ color: DIM, fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}
          >
            {tr(locale, { ru: 'код', en: 'code' })}: {code}
          </span>
        </main>
      </body>
    </html>
  )
}
