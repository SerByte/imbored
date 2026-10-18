import { ImageResponse } from 'next/og'
import { loadCompatInvite } from '@/lib/compatpage'
import { ogFonts, OG_BG, OG_INK } from '@/lib/og'
import { postersOf, WALL_POSTERS } from '@/lib/ogcard'
import { getDb } from '@/lib/server'
import { CompatCardImage } from './share-card'
import { isLocale, toLocale } from '@/lib/i18n'

/**
 * Подпись константой модуля — языка у неё нет. На /en её заменяет английская:
 * страница объявляет свой openGraph.images (cardOn в page.tsx), а Next файловую
 * карточку тогда не подставляет. Русская страница получает эту, как раньше.
 */
export const alt = 'Сравнить игровые вкусы — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Без revalidate Next статически оптимизирует картинку, и превью замирает на
 * первом отрендеренном состоянии навсегда.
 *
 * Сессию здесь читать нельзя — и не только из-за кэша: картинку тянет краулер
 * мессенджера, у которого куки чужие или никаких. Всё, что нарисовано, взято из
 * профиля владельца ссылки.
 */
export const revalidate = 3600

/**
 * Регистрирует сегмент в манифесте — без этого revalidate выше мёртв.
 *
 * Пустой список намеренно: предрендерить тут нечего — адреса персональные.
 * Смысл функции не в предрендере, а в РЕГИСТРАЦИИ. Без неё динамический
 * сегмент не попадает в dynamicRoutes манифеста, и revalidate выше не значит
 * ничего: маршрут остаётся ƒ и рендерится заново на каждый запрос.
 *
 * Это уже было выяснено в app/game/[appid]/page.tsx — там та же функция
 * стоит с той же оговоркой «обязателен, и не ради предрендера». Здесь просто
 * не применили, и картинки платили за это полностью: три запроса подряд к
 * /compat/[steamid]/opengraph-image на проде дали три x-vercel-cache: MISS,
 * Age: 0, по 366–577 КБ и 1–2,6 секунды на каждый. Проверено сборкой: с этой
 * функцией маршрут в листинге меняется с ƒ на ●.
 *
 * Картинку тянет краулер мессенджера — у одной разосланной ссылки таких
 * заходов столько, скольким её переслали.
 */
export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

export default async function Image({ params }: { params: Promise<{ lang: string; steamid: string }> }) {
  const { lang, steamid } = await params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return new Response('Not found', { status: 404 })
  const locale = toLocale(lang)
  // Язык карточки — язык адреса: /en/compat/…/opengraph-image рисует
  // английскую, с именем демо-владельца по-английски (nameOf)
  const invite = /^\d{17}$/.test(steamid)
    ? await loadCompatInvite(await getDb(), steamid, { top: WALL_POSTERS, locale })
    : null

  if (!invite) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: OG_BG,
            color: OG_INK,
            fontFamily: 'Manrope',
            fontSize: 56,
          }}
        >
          imbored.cc
        </div>
      ),
      { ...size, fonts: await ogFonts },
    )
  }

  // Постеры — заранее и со своим таймаутом (ogPoster), а не адресами для satori
  const byId = new Map(invite.topGames.map((g) => [g.appid, g]))
  const posters = await postersOf(invite.topGames, (id) => byId.get(id))

  return new ImageResponse(<CompatCardImage invite={invite} posters={posters} locale={locale} />, {
    ...size,
    fonts: await ogFonts,
  })
}
