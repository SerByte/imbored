import { NextResponse } from 'next/server'
import { listPublicRooms } from '@/lib/db'
import { getDb, nowSec } from '@/lib/server'

/**
 * Доска открытых пати. Ответ одинаков для всех — ничего персонального здесь
 * нет и быть не может, — а страница /rooms опрашивает ручку из каждой открытой
 * вкладки. Общий кэш на краю схлопывает N вкладок в одно обращение к origin
 * раз в пять секунд.
 *
 * stale-while-revalidate шире самого окна намеренно: доска — это «кто ищет
 * прямо сейчас», и показать её на секунду устаревшей заметно лучше, чем
 * подождать. Пять секунд свежести при клиентском интервале в восемь означают,
 * что реально устаревших ответов почти не бывает.
 */
export async function GET() {
  const now = nowSec()
  const rooms = (await listPublicRooms(await getDb(), now)).map((r) => ({
    id: r.id,
    memberNames: r.memberNames,
    minutesAgo: Math.max(0, Math.round((now - r.createdAt) / 60)),
  }))
  return NextResponse.json(
    { rooms },
    { headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=25' } },
  )
}
