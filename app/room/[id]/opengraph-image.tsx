import { ImageResponse } from 'next/og'
import { ogFonts, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'

export const alt = 'Тебя зовут в пати — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/**
 * Карточка приглашения в пати.
 *
 * Ссылку на комнату кидают в чат — это её единственный способ распространения,
 * и до сих пор она приезжала туда голым адресом. Код крупно, потому что его
 * диктуют вслух и сверяют глазами; ровно та же логика, что у FlapCode на самой
 * странице.
 *
 * В базу не ходим: всё нужное есть в адресе. Состав комнаты постороннему
 * показывать не за что, а лишний запрос на пути краулера — тем более.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const code = ROOM_ID_RE.test(id) ? id : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          background: OG_BG,
          fontFamily: 'Onest',
        }}
      >
        <div style={{ display: 'flex', color: OG_DIM, fontSize: 34, letterSpacing: 2 }}>
          ТЕБЯ ЗОВУТ ВЫБРАТЬ ИГРУ НА ВЕЧЕР
        </div>

        {code ? (
          <div
            style={{
              display: 'flex',
              gap: 14,
            }}
          >
            {code.split('').map((ch, i) => (
              <div
                key={`${ch}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 116,
                  height: 150,
                  borderRadius: 20,
                  background: '#15171d',
                  color: OG_INK,
                  fontSize: 96,
                  fontFamily: 'JetBrains Mono',
                }}
              >
                {ch}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', color: OG_INK, fontSize: 96 }}>Пати</div>
        )}

        <div style={{ display: 'flex', color: OG_DIM, fontSize: 30, marginTop: 8 }}>
          Подключи библиотеку — соберём колоду из общих игр
        </div>
        <div
          style={{
            display: 'flex',
            color: OG_EMBER,
            fontSize: 26,
            fontFamily: 'JetBrains Mono',
          }}
        >
          imbored.cc
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
