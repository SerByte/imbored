import { isrImage } from '@/lib/ogresponse'
import { YearCardImage, fonts, loadYearCardData } from '../share-card'
import { isLocale } from '@/lib/i18n'

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
  { params }: { params: Promise<{ lang: string; steamid: string }> },
): Promise<Response> {
  const { lang, steamid } = await params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return new Response('Not found', { status: 404 })
  // Язык — из params: next/root-params в обработчиках картинок не работает
  const data = await loadYearCardData(steamid, lang)
  if (!data) return new Response('Not found', { status: 404 })

  return isrImage(<YearCardImage data={data} wide={false} />, {
    ...SIZE,
    fonts: await fonts,
  })
}
