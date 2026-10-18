import { ImageResponse } from 'next/og'
import { OG_BG, OG_INK } from '@/lib/og'
import { YearCardImage, fonts, loadYearCardData } from './share-card'
import { isLocale } from '@/lib/i18n'

export const alt = 'Итоги года — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** Без revalidate Next статически оптимизирует картинку, и превью замирает навсегда */
export const revalidate = 3600

/**
 * Регистрирует сегмент в манифесте — без этого revalidate выше мёртв (см.
 * такую же функцию у портрета). Пустой список: адреса персональные.
 */
export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

export default async function Image({ params }: { params: Promise<{ lang: string; steamid: string }> }) {
  const { lang, steamid } = await params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return new Response('Not found', { status: 404 })
  // Язык — из params: next/root-params в обработчиках картинок не работает
  const data = await loadYearCardData(steamid, lang)

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
            background: OG_BG,
            color: OG_INK,
            fontFamily: 'Manrope',
            fontSize: 56,
          }}
        >
          imbored.cc
        </div>
      ),
      { ...size, fonts: await fonts },
    )
  }

  return new ImageResponse(<YearCardImage data={data} wide />, { ...size, fonts: await fonts })
}
