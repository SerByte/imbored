import { ImageResponse } from 'next/og'
import { ogFonts, ogGlow, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { ArtBackdrop, ogArt } from '@/lib/ogcard'
import { CANVAS_WIDE } from '@/lib/ogwall'
import { inviteCopy } from '@/lib/roominvite'
import { loadRoomInvite, ROOM_ID_RE } from './invite'
import { isLocale, tr } from '@/lib/i18n'

/*
 * Подпись картинки — одна на оба языка и без слов языка: alt у файловой
 * карточки статичен, а generateImageMetadata дописал бы к адресу картинки
 * свой хвост, и сброс кэша карточки по roomCardPath (lib/roomcard)
 * промахивался бы. Русская подпись на английской странице — кириллица в
 * превью, двуязычная — тоже, поэтому — имя продукта: что это приглашение,
 * говорят заголовок и описание превью, они на языке страницы (inviteCopy).
 */
export const alt = 'imbored'
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
 * После матча билет погашен: код остаётся героем, но строка под ним называет
 * игру, на которой сошлись, а подвал зовёт собрать свою комнату. Раньше
 * карточка звала свайпать и в сошедшуюся комнату — ссылку ведь пересылают и
 * после матча. Тексты общие с заголовком страницы — inviteCopy.
 *
 * Комната, созданная «Позвать в эту игру», — билет на конкретную игру: её арт
 * встаёт фоном ещё до матча, а строка под кодом зовёт в неё. Это то самое «го
 * в Valheim?», которое иначе ушло бы в чат текстом без картинки. Настроение
 * вечера — словами (надзаголовок или строка под кодом), без эмодзи пресета:
 * шрифта с эмодзи у next/og здесь нет, и на его месте встал бы квадрат.
 *
 * Комнаты живут часами, а не сутками: пять минут кэша достаточно, чтобы
 * пережить всплеск пересылок, и мало, чтобы врать про число вошедших. При
 * молчащей базе loadRoomInvite отдаёт null, и карточка честно превращается в
 * приглашение без счётчика, а не в ошибку у краулера.
 */
export const revalidate = 300

/**
 * Регистрирует сегмент в манифесте — без этого revalidate выше мёртв.
 *
 * Пустой список намеренно: предрендерить тут нечего — адреса персональные.
 * Смысл функции не в предрендере, а в РЕГИСТРАЦИИ. Без неё динамический
 * сегмент не попадает в dynamicRoutes манифеста, и revalidate выше не значит
 * ничего: маршрут остаётся ƒ и рендерится заново на каждый запрос — те самые
 * пять минут кэша на всплеск пересылок не работали бы вовсе.
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

export default async function Image({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params
  // Язык не из LOCALES (/_x/…) — 404: notFound() корневого layout до обработчика не доходит
  if (!isLocale(lang)) return new Response('Not found', { status: 404 })
  const code = id.toUpperCase()
  // Без потолка room-peek, в отличие от заголовка страницы, — сознательно:
  // headers() выбил бы карточку из ISR. Почему это терпимо — lib/roompeek
  const invite = ROOM_ID_RE.test(code) ? await loadRoomInvite(code) : null
  // Те же три состояния, что у заголовка страницы: ждёт, сошлась, неизвестна —
  // на языке адреса карточки (/en/room/…/opengraph-image — по-английски)
  const { eyebrow, headline, foot } = inviteCopy(code, invite, lang)
  // Английская строка с игрой («{host} invites you to “X”») длиннее русской,
  // встаёт в две строки и рвалась на дефисе внутри названия: «… “Counter-» /
  // «Strike 2”». Название в кавычках — отдельным куском, целиком: перенос
  // встаёт перед ним. Влезает в одну строку — так и стоит, через пробел
  // (columnGap ≈ пробел Manrope на 44). Русская карточка рисуется прежней
  // веткой, до пикселя как была
  const quote = lang === 'en' ? headline.indexOf('“') : -1
  // После матча билет погашен — и фоном встаёт игра, на которой сошлись; до
  // матча — игра, в которую звали, если она есть. Арт не дотянулся (чужой
  // магазин, сбой CDN) — прежний билет на тёмном
  const artRef = invite?.matched ? invite.matchedArt : invite?.seedArt
  const art = artRef ? await ogArt(artRef) : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: OG_BG,
          ...(art ? {} : { backgroundImage: ogGlow() }),
          color: OG_INK,
          fontFamily: 'Manrope',
        }}
      >
        {art && <ArtBackdrop src={art} canvas={CANVAS_WIDE} />}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            ...CANVAS_WIDE,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '64px 72px',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontFamily: 'Manrope',
              fontSize: 20,
              letterSpacing: 6,
              color: OG_EMBER,
            }}
          >
            {eyebrow}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Код — предмет, который передают. Разрядка как на билете. */}
            <div
              style={{
                display: 'flex',
                fontFamily: 'JetBrains Mono',
                // На арте код скромнее: ему лежать в тёмной части скрима, а не на картинке
                fontSize: art ? 96 : 132,
                letterSpacing: 16,
                lineHeight: 1,
                color: OG_INK,
              }}
            >
              {ROOM_ID_RE.test(code) ? code : tr(lang, { ru: 'ПАТИ', en: 'PARTY' })}
            </div>
            {/* Отступ с запасом — см. lib/og про кириллические выносные */}
            {quote > 0 ? (
              <div
                style={{ display: 'flex', flexWrap: 'wrap', columnGap: 11, marginTop: 36, fontSize: 44, maxWidth: 900 }}
              >
                <span>{headline.slice(0, quote).trimEnd()}</span>
                <span>{headline.slice(quote)}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', marginTop: 36, fontSize: 44, maxWidth: 900 }}>{headline}</div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', fontSize: 26, color: OG_DIM, maxWidth: 880 }}>{foot}</div>
            <div
              style={{
                display: 'flex',
                fontFamily: 'Manrope',
                fontSize: 20,
                letterSpacing: 3,
                color: OG_EMBER,
              }}
            >
              IMBORED.CC
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts },
  )
}
