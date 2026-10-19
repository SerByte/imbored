import type { CompatInvite } from '@/lib/compatpage'
import { gamesCaption, hoursCaption } from '@/lib/factcaptions'
import { tr, type Locale } from '@/lib/i18n'
import { ogNum, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { PosterWall, WallShade } from '@/lib/ogcard'
import { CANVAS_WIDE, WALL_WIDE } from '@/lib/ogwall'

/**
 * Карточка для мессенджера. Рисуется на сервере через next/og.
 *
 * Она ПРИГЛАШАЕТ, а не показывает результат, и это не стилистический выбор:
 * процент зависит от того, кто открыл ссылку, а у краулера сессии нет вовсе.
 * Показать здесь число значило бы либо выдумать его, либо показать чужое —
 * поэтому в углу «?%»: число появится у того, кто откроет.
 *
 * Библиотека того, кто зовёт, — стеной постеров во весь холст, как у
 * портрета (lib/ogcard): раньше здесь была полоска из пяти обложек на
 * прозрачности, и карточка читалась таблицей, а не чьей-то библиотекой.
 *
 * Про satori надо помнить две вещи (обе выучены на портрете): любому div с
 * несколькими детьми нужен явный display: flex, а у кириллицы «р», «у», «д»
 * уходят заметно ниже базовой линии и съедают margin снизу.
 *
 * Язык — от адреса карточки (opengraph-image): /en/compat/… разворачивается
 * в чате английской. Заголовок — та же фраза, что у вкладки и героя
 * приглашения («… wants to compare libraries»), и при имени до 20 знаков на
 * 64 px он занимает не больше строк, чем русский.
 */
export function CompatCardImage({
  invite,
  posters,
  locale = 'ru',
}: {
  invite: CompatInvite
  posters: string[]
  locale?: Locale
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: OG_BG,
        color: OG_INK,
        fontFamily: 'Manrope',
        overflow: 'hidden',
      }}
    >
      <PosterWall posters={posters} spec={WALL_WIDE} />
      <WallShade canvas={CANVAS_WIDE} />

      <div
        style={{
          position: 'absolute',
          top: 40,
          right: 64,
          display: 'flex',
          fontSize: 96,
          color: OG_EMBER,
          letterSpacing: -2,
        }}
      >
        ?%
      </div>

      <div
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          bottom: 44,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ fontSize: 20, letterSpacing: 6, color: OG_EMBER, marginBottom: 18 }}>
          {tr(locale, { ru: 'IMBORED.CC · СОВМЕСТИМОСТЬ', en: 'IMBORED.CC · COMPATIBILITY' })}
        </div>
        {/* Отступ снизу большой намеренно — см. докблок про кириллические выносные */}
        <div style={{ fontSize: 64, lineHeight: 1.15, marginBottom: 30 }}>
          {tr(locale, {
            ru: `${invite.name.slice(0, 20)} зовёт сравнить библиотеки`,
            en: `${invite.name.slice(0, 20)} wants to compare libraries`,
          })}
        </div>
        {/* Время скрыто настройками Steam (lib/playtime.ts) — слово, а не
            «0 часов»: картинку из чата уже не отозвать */}
        <div style={{ display: 'flex' }}>
          <Stat value={ogNum(invite.gamesCount, locale)} caption={gamesCaption(invite.gamesCount, locale)} />
          {invite.playtimeHidden ? (
            <Stat
              value={tr(locale, { ru: 'скрыто', en: 'hidden' })}
              caption={tr(locale, { ru: 'время в играх', en: 'playtime' })}
            />
          ) : (
            <Stat value={ogNum(invite.totalHours, locale)} caption={hoursCaption(invite.totalHours, locale)} />
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ value, caption }: { value: string; caption: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginRight: 64 }}>
      <div style={{ fontSize: 44, color: OG_INK }}>{value}</div>
      <div style={{ fontSize: 20, color: OG_DIM, marginTop: 4 }}>{caption}</div>
    </div>
  )
}
