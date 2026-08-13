import { ImageResponse } from 'next/og'
import { CardImage, fonts, loadCardData } from './share-card'

export const alt = 'Портрет игрока — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Без revalidate Next статически оптимизирует картинку, и превью замирает на
 * первом отрендеренном состоянии навсегда.
 */
export const revalidate = 3600

export default async function Image({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params
  const data = await loadCardData(steamid)

  if (!data) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0b0c10',
            color: '#f2f3f5',
            fontFamily: 'Onest',
            fontSize: 56,
          }}
        >
          imbored.cc
        </div>
      ),
      { ...size, fonts: await fonts },
    )
  }

  return new ImageResponse(<CardImage data={data} wide />, { ...size, fonts: await fonts })
}
