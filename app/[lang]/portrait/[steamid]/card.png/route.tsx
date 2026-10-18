import { ImageResponse } from 'next/og'
import { CardImage, fonts, loadCardData } from '../share-card'

/**
 * Вертикальная карточка на скачивание — формат сторис, чтобы её можно было
 * выложить, а не только отправить ссылкой. Та же начинка, что у OG-превью.
 */
const SIZE = { width: 1080, height: 1350 }

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ steamid: string }> },
): Promise<Response> {
  const { steamid } = await params
  const data = await loadCardData(steamid)
  if (!data) return new Response('Not found', { status: 404 })

  return new ImageResponse(<CardImage data={data} wide={false} />, {
    ...SIZE,
    fonts: await fonts,
  })
}
