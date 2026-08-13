import { ImageResponse } from 'next/og'
import { CardImage, fonts, loadCardData } from '../share-card'

/**
 * Вертикальная карточка на скачивание — формат сторис, чтобы её можно было
 * выложить, а не только отправить ссылкой. Та же начинка, что у OG-превью.
 */
const SIZE = { width: 1080, height: 1350 }

export const revalidate = 3600

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
