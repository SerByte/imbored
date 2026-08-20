'use client'

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
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="ru">
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
        <title>Что-то сломалось · imbored</title>
        <style>{`
          :root { color-scheme: dark }
          @media (prefers-color-scheme: light) {
            :root { color-scheme: light }
            body { background: ${LIGHT_BG} !important; color: ${LIGHT_INK} !important }
            .ge-dim { color: ${LIGHT_DIM} !important }
            /* Заливка и текст на ней меняются ПАРОЙ — точно так же, как --ember и
               --on-ember в globals.css. Оставить тёмный ember на молочном листе
               было бы читаемо (9.61:1), но это был бы не тот оттенок бренда. */
            .ge-btn { background: ${LIGHT_EMBER} !important; color: ${LIGHT_INK} !important }
          }
          .ge-btn { transition: filter .15s ease }
          .ge-btn:hover { filter: brightness(1.1) }
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
            <rect width="64" height="64" rx="16" fill={PLATE} />
            <circle cx="22" cy="25" r="5.5" fill="#f2f3f5" />
            <circle cx="22" cy="42" r="5.5" fill="#f2f3f5" />
            <line x1="36" y1="22" x2="46" y2="45" stroke={EMBER} strokeWidth="9" strokeLinecap="round" />
          </svg>

          <h1 style={{ margin: 0, fontSize: '26px', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            Что-то сломалось целиком
          </h1>

          <p className="ge-dim" style={{ margin: 0, fontSize: '15px', lineHeight: 1.6, color: DIM }}>
            Упало не на странице, а во всём приложении сразу. Скорее всего, это на нашей стороне и
            уже чинится — попробуй ещё раз.
          </p>

          <button
            type="button"
            onClick={() => retry()}
            className="ge-btn"
            style={{
              width: '100%',
              border: 0,
              borderRadius: '14px',
              background: EMBER,
              color: BG,
              font: 'inherit',
              fontWeight: 600,
              fontSize: '15px',
              padding: '13px 20px',
              cursor: 'pointer',
            }}
          >
            Попробовать снова
          </button>

          {/*
            Обычная <a>, а не <Link>, и правило линтера здесь ошибается. <Link>
            делает клиентский переход, то есть оставляет жить то самое дерево React,
            которое только что развалилось целиком. Полная перезагрузка тут не издержка,
            а смысл: корневой layout отрабатывает заново.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="ge-link ge-dim"
            style={{ color: DIM, fontSize: '14px', textDecoration: 'none' }}
          >
            На главную
          </a>

          {/* Код нужен не человеку, а нам: по нему ошибка находится в логах.
              Поэтому он тихий и стоит последним. */}
          {error.digest && (
            <span
              className="ge-dim"
              style={{ color: DIM, fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}
            >
              код: {error.digest}
            </span>
          )}
        </main>
      </body>
    </html>
  )
}
