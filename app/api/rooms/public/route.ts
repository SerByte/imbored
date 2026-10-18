import { NextResponse } from 'next/server'
import { listPublicRooms } from '@/lib/db'
import { localeFromRequest } from '@/lib/i18n'
import { presetLabel, roomPresetOf } from '@/lib/presets'
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
 *
 * preset — на какой вечер зовут, названием и эмодзи пресета хоста: «⚡ Пара
 * быстрых каток» отвечает незнакомцу на «подсесть ли мне сюда» до того, как
 * он вошёл. Внутри комнаты это и так видит каждый (шапка комнаты). Своё
 * сочетание осей без пресета — null: называть его чужим именем нельзя.
 *
 * Язык — в адресе (?lang=en, withLang у /rooms), и только там: ответ общий
 * на край, и ключ кэша — сам адрес. Английская доска — английские метки
 * участников («Demo friend», «Player ab12») и название пресета; русская —
 * прежняя до байта.
 */
export async function GET(req: Request) {
  const now = nowSec()
  const locale = localeFromRequest(req)
  const rooms = (await listPublicRooms(await getDb(), now, locale)).map((r) => {
    const preset = roomPresetOf(r.mood)
    return {
      id: r.id,
      memberNames: r.memberNames,
      minutesAgo: Math.max(0, Math.round((now - r.createdAt) / 60)),
      preset: preset ? { label: presetLabel(preset, locale), emoji: preset.emoji } : null,
    }
  })
  return NextResponse.json(
    { rooms },
    { headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=25' } },
  )
}
