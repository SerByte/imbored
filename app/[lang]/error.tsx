'use client'

import Link from '@/components/Link'
import { useEffect } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { LogoMark } from '@/components/Logo'
import { clientErrorCode, isChunkLoadError, reportClientError } from '@/lib/clienterr'
import { tr } from '@/lib/i18n'

/**
 * Граница ошибок приложения. До этого любое исключение в серверном компоненте
 * показывало стоковый экран Next — без шапки, без языка продукта, без выхода.
 *
 * Самого корневого layout и template эта граница НЕ касается — там работает
 * app/global-error.tsx, заведённый рядом.
 *
 * retry, а НЕ reset, и это починка, а не переименование. reset чистит
 * состояние границы и перерисовывает детей БЕЗ повторного запроса — то есть из
 * того же payload, который только что упал. А этот экран заводился именно под
 * исключения в СЕРВЕРНЫХ компонентах: единственная кнопка экрана
 * выглядела нажатой и не делала ничего. retry запрашивает содержимое заново
 * (docs/error.md: «will try to re-fetch and re-render») и стабилен с Next 16.3.
 *
 * Код на экране — всегда. У серверной ошибки это digest, и её уже записал
 * onRequestError. У клиентской digest нет: код считается из самой ошибки
 * (clientErrorCode), и тот же код уходит в отчёт на /api/clienterr — иначе
 * падение в компоненте /play или /room не видел бы никто, кроме человека.
 *
 * НЕ ПРИШЁЛ КУСОК КОДА — КНОПКА ПЕРЕЗАГРУЖАЕТ, А НЕ ПОВТОРЯЕТ. retry
 * перерисовывает тот же React.lazy, а он помнит отказ и бросает его снова;
 * «На главную» — клиентский переход, и если кусок был главной, он
 * монтируется заново и падает так же. Человек жал обе кнопки и стоял на том
 * же экране. Перезагрузка тянет свежий HTML со ссылками на куски текущей
 * сборки (lib/clienterr, isChunkLoadError). Только по нажатию — зациклиться
 * ей не на чем.
 *
 * Язык — из контекста (useLocale): граница стоит под корневым layout, и его
 * провайдер у неё есть, в отличие от app/global-error.tsx, которому язык
 * приходится читать из адреса.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const locale = useLocale()
  const code = error.digest ?? clientErrorCode(error)
  const stale = isChunkLoadError(error)

  useEffect(() => {
    console.error(error)
    if (!error.digest) {
      reportClientError({ kind: 'boundary', error, href: window.location.href, code })
    }
  }, [error, code])

  return (
    <div className="flex-1 flex items-center justify-center px-5 py-24">
      <div className="max-w-md w-full panel-lift p-8 text-center flex flex-col items-center gap-5 anim-reveal">
        <LogoMark size={48} />
        <h1 className="font-display text-display-sm">{tr(locale, { ru: 'Что-то сломалось', en: 'Something broke' })}</h1>
        <p className="text-dim text-sm leading-relaxed">
          {tr(locale, {
            ru: 'Скорее всего, это на нашей стороне. Можно попробовать ещё раз — обычно помогает.',
            en: 'It’s most likely on our end. Try again — that usually helps.',
          })}
        </p>
        <button
          onClick={() => (stale ? window.location.reload() : retry())}
          className="btn-ember is-block py-3"
        >
          {stale
            ? tr(locale, { ru: 'Обновить страницу', en: 'Reload page' })
            : tr(locale, { ru: 'Попробовать снова', en: 'Try again' })}
        </button>
        <Link href="/" className="tap text-sm text-dim hover:text-ink transition-colors">
          {tr(locale, { ru: 'На главную', en: 'Back to home' })}
        </Link>
        <span className="text-[11px] tabular-nums text-faint">
          {tr(locale, { ru: 'код: ', en: 'code: ' })}
          {code}
        </span>
      </div>
    </div>
  )
}
