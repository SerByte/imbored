import { ImageResponse } from 'next/og'
import { ogFonts, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'

export const alt = 'Тебя зовут в пати — imbored'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/**
 * Сутки, и это с запасом: картинка целиком выводится из кода комнаты и не
 * меняется никогда. Без revalidate вместе с generateStaticParams ниже
 * маршрут остаётся динамическим и перерисовывает одну и ту же картинку на
 * каждый заход краулера.
 */
export const revalidate = 86_400

/**
 * Регистрирует сегмент в манифесте — без этого revalidate выше мёртв.
 *
 * Пустой список намеренно: предрендерить тут нечего — адреса персональные.
 * Смысл функции не в предрендере, а в РЕГИСТРАЦИИ. Без неё динамический
 * сегмент не попадает в dynamicRoutes манифеста, и revalidate выше не значит
 * ничего: маршрут остаётся ƒ и рендерится заново на каждый запрос.
 *
 * Это уже было выяснено в app/game/[appid]/page.tsx — там та же функция
 * стоит с той же оговоркой «обязателен, и не ради предрендера». Здесь просто
 * не применили, и картинки платили за это полностью: три запроса подряд к
 * /compat/[steamid]/opengraph-image на проде дали три x-vercel-cache: MISS,
 * Age: 0, по 366–577 КБ и 1–2,6 секунды на каждый. Проверено сборкой: с этой
 * функцией маршрут в листинге меняется с ƒ на ●.
 *
 * Картинку тянет краулер мессенджера — у одной разосланной ссылки таких
 * заходов столько, скольким её переслали.
 */
export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return []
}

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
