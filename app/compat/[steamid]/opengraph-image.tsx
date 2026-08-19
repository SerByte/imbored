import { ImageResponse } from 'next/og'
import { loadCompatInvite } from '@/lib/compatpage'
import { ogFonts, OG_BG, OG_INK } from '@/lib/og'
import { getDb } from '@/lib/server'
import { CompatCardImage } from './share-card'

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

export default async function Image({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params
  const invite = /^\d{17}$/.test(steamid) ? await loadCompatInvite(await getDb(), steamid) : null

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
            fontFamily: 'Onest',
            fontSize: 56,
          }}
        >
          imbored.cc
        </div>
      ),
      { ...size, fonts: await ogFonts },
    )
  }

  return new ImageResponse(<CompatCardImage invite={invite} />, {
    ...size,
    fonts: await ogFonts,
  })
}
