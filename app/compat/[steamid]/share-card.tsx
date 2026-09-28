import type { CompatInvite } from '@/lib/compatpage'
import { gamesCaption, hoursCaption } from '@/lib/factcaptions'
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
 */
export function CompatCardImage({ invite, posters }: { invite: CompatInvite; posters: string[] }) {
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
          IMBORED.CC · СОВМЕСТИМОСТЬ
        </div>
        {/* Отступ снизу большой намеренно — см. докблок про кириллические выносные */}
        <div style={{ fontSize: 64, lineHeight: 1.15, marginBottom: 30 }}>
          {`${invite.name.slice(0, 20)} зовёт сравнить библиотеки`}
        </div>
        <div style={{ display: 'flex' }}>
          <Stat value={ogNum(invite.gamesCount)} caption={gamesCaption(invite.gamesCount)} />
          <Stat value={ogNum(invite.totalHours)} caption={hoursCaption(invite.totalHours)} />
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
