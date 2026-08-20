import { ImageResponse } from 'next/og'
import { ogFonts, ogGlow, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { plural } from '@/lib/plural'
import { loadRoomInvite, ROOM_ID_RE } from './invite'

export const alt = 'Приглашение в пати — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Билет, а не баннер.
 *
 * Ссылку на комнату кидают в чат друзьям, и до этой карточки она
 * разворачивалась общим знаком продукта — то есть выглядела ровно как ссылка
 * на главную. Понять, что это приглашение, было нельзя, не открыв её.
 *
 * Героем стоит КОД, а не фраза: код — это и есть предмет, который передают.
 * Он набран моноширинным с большим разрядкой — так печатают номер на билете,
 * и так же он выглядит в самой комнате.
 *
 * Комнаты живут часами, а не сутками: пять минут кэша достаточно, чтобы
 * пережить всплеск пересылок, и мало, чтобы врать про число вошедших. При
 * молчащей базе loadRoomInvite отдаёт null, и карточка честно превращается в
 * приглашение без счётчика, а не в ошибку у краулера.
 */
export const revalidate = 300

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const code = id.toUpperCase()
  const invite = ROOM_ID_RE.test(code) ? await loadRoomInvite(code) : null

  const headline = invite?.host
    ? `${invite.host.slice(0, 18)} зовёт выбрать игру на вечер`
    : 'Тебя зовут выбрать игру на вечер'

  const foot = invite
    ? `${invite.members} ${plural(invite.members, 'человек в комнате', 'человека в комнате', 'человек в комнате')} · подключи библиотеку и свайпай`
    : 'Подключи библиотеку и свайпай — совпадут голоса всех, будет матч'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: OG_BG,
          backgroundImage: ogGlow(),
          color: OG_INK,
          fontFamily: 'Onest',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontFamily: 'JetBrains Mono',
            fontSize: 20,
            letterSpacing: 6,
            color: OG_EMBER,
          }}
        >
          ПАТИ · ПРИГЛАШЕНИЕ
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Код — предмет, который передают. Разрядка как на билете. */}
          <div
            style={{
              display: 'flex',
              fontFamily: 'JetBrains Mono',
              fontSize: 132,
              letterSpacing: 16,
              lineHeight: 1,
              color: OG_INK,
            }}
          >
            {ROOM_ID_RE.test(code) ? code : 'ПАТИ'}
          </div>
          {/* Отступ с запасом — см. lib/og про кириллические выносные */}
          <div style={{ display: 'flex', marginTop: 36, fontSize: 44, maxWidth: 900 }}>{headline}</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: 26, color: OG_DIM, maxWidth: 880 }}>{foot}</div>
          <div
            style={{
              display: 'flex',
              fontFamily: 'JetBrains Mono',
              fontSize: 20,
              letterSpacing: 3,
              color: OG_EMBER,
            }}
          >
            IMBORED.CC
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
