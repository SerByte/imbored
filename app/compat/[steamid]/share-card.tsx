import { artCandidates } from '@/lib/art'
import type { CompatInvite } from '@/lib/compatpage'
import { ogNum, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'

/**
 * Карточка для мессенджера. Рисуется на сервере через next/og.
 *
 * Она ПРИГЛАШАЕТ, а не показывает результат, и это не стилистический выбор:
 * процент зависит от того, кто открыл ссылку, а у краулера сессии нет вовсе.
 * Показать здесь число значило бы либо выдумать его, либо показать чужое.
 *
 * Композиция намеренно та же, что у шапки самой страницы, — лента обложек,
 * под ней текст: превью в чате и страница, на которую оно ведёт, должны быть
 * одной картинкой, иначе переход выглядит как попадание не туда.
 *
 * Про satori надо помнить две вещи (обе выучены на портрете): любому div с
 * несколькими детьми нужен явный display: flex, а у кириллицы «р», «у», «д»
 * уходят заметно ниже базовой линии и съедают margin снизу.
 */

/** Обложек ровно столько, сколько успеет вытянуть краулер: satori тянет каждую сам. */
const COVERS = 5

export function CompatCardImage({ invite }: { invite: CompatInvite }) {
  const covers = invite.topGames
    .map((g) => artCandidates({ appid: g.appid, art: g.art, headerImage: g.headerImage })[0])
    .filter((url): url is string => Boolean(url))
    .slice(0, COVERS)

  const coverWidth = 1200 / COVERS

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: OG_BG,
        color: OG_INK,
        fontFamily: 'Onest',
      }}
    >
      <div style={{ display: 'flex', height: 150, opacity: 0.3, overflow: 'hidden' }}>
        {covers.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            width={coverWidth}
            height={150}
            style={{ width: coverWidth, height: 150, objectFit: 'cover' }}
            alt=""
          />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: '48px 64px',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'JetBrains Mono',
            fontSize: 20,
            letterSpacing: 6,
            color: OG_EMBER,
            marginBottom: 18,
          }}
        >
          IMBORED.CC · СОВМЕСТИМОСТЬ
        </div>

        {/* Отступ снизу большой намеренно — см. докблок про кириллические выносные */}
        <div style={{ fontSize: 68, lineHeight: 1.15, marginBottom: 44 }}>
          {`${invite.name.slice(0, 20)} зовёт сравнить библиотеки`}
        </div>

        <div style={{ fontSize: 28, color: OG_DIM }}>
          {`${ogNum(invite.gamesCount)} игр · ${ogNum(invite.totalHours)} часов в библиотеке`}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          padding: '0 64px 44px',
          fontFamily: 'JetBrains Mono',
          fontSize: 20,
          color: OG_EMBER,
          letterSpacing: 3,
        }}
      >
        IMBORED.CC
      </div>
    </div>
  )
}
