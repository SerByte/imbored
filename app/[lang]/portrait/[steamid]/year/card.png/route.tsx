import { ImageResponse } from 'next/og'
import { YearCardImage, fonts, loadYearCardData } from '../share-card'

/**
 * Итоги года на скачивание — формат сторис, как у карточки портрета.
 * route.tsx, а не opengraph-image: превью обязано быть 1200×630.
 */
const SIZE = { width: 1080, height: 1350 }

export const revalidate = 3600

/** Регистрирует сегмент в манифесте — без этого revalidate выше мёртв */
export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ steamid: string }> },
): Promise<Response> {
  const { steamid } = await params
  const data = await loadYearCardData(steamid)
  if (!data) return new Response('Not found', { status: 404 })

  return new ImageResponse(<YearCardImage data={data} wide={false} />, {
    ...SIZE,
    fonts: await fonts,
  })
}
