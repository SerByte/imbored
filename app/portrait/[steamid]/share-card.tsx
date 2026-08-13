import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { artCandidates } from '@/lib/art'
import { getGamesMeta, getLatestSnapshot, getPersonaName } from '@/lib/db'
import { buildPortrait } from '@/lib/portrait'
import { getDb } from '@/lib/server'
import { buildWrapped } from '@/lib/wrapped'

/**
 * Общая начинка для двух картинок: OG-превью 1200×630 и скачиваемой карточки
 * 1080×1350. Рисуется на сервере через next/og.
 *
 * Почему не canvas на клиенте: steamstatic не отдаёт CORS-заголовков, любая
 * обложка делает canvas tainted и toBlob() падает.
 *
 * Шрифты лежат в assets/ как woff: ImageResponse принимает только ttf/otf/woff
 * (next/font/google отдаёт woff2 и доступа к бинарнику не даёт), а без буфера
 * с кириллицей satori рисует пустоту вместо ника.
 */

const FONT_DIR = join(process.cwd(), 'assets')

/** Ассеты не зависят от запроса — читаем один раз на модуль. */
export const fonts = Promise.all([
  readFile(join(FONT_DIR, 'Onest-ExtraBold.woff')),
  readFile(join(FONT_DIR, 'JetBrainsMono-Bold.woff')),
]).then(([sans, mono]) => [
  { name: 'Onest', data: sans, style: 'normal' as const, weight: 800 as const },
  { name: 'JetBrains Mono', data: mono, style: 'normal' as const, weight: 700 as const },
])

export type CardData = {
  name: string
  totalHours: number
  gamesCount: number
  unplayedCount: number
  archetypes: string[]
  covers: string[]
  topGame: { name: string; sharePercent: number } | null
}

/** Обложек ровно столько, сколько успеет вытянуть краулер: satori тянет каждую сам. */
const COVERS = 5

export async function loadCardData(steamid: string): Promise<CardData | null> {
  if (!/^\d{17}$/.test(steamid)) return null
  const db = await getDb()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return null

  const games = snapshot.games
  const metas = await getGamesMeta(
    db,
    games.map((g) => g.appid),
  )
  const metaOf = (id: number) => metas.get(id)
  const portrait = buildPortrait(games, metaOf)
  const wrapped = buildWrapped(games, metaOf)

  const covers = wrapped.top
    .filter((g) => g.appid > 0)
    .slice(0, COVERS)
    .map((g) => {
      const meta = metaOf(g.appid)
      return artCandidates({ appid: g.appid, art: meta?.art ?? null, headerImage: meta?.headerImage ?? null })[0]
    })
    .filter((url): url is string => Boolean(url))

  return {
    name: (await getPersonaName(db, steamid)) ?? `Игрок ${steamid.slice(-4)}`,
    totalHours: wrapped.totalHours,
    gamesCount: wrapped.gamesCount,
    unplayedCount: wrapped.unplayedCount,
    archetypes: portrait.archetypes.filter((a) => a.known).slice(0, 2).map((a) => a.label),
    covers,
    topGame: portrait.facts.topGame,
  }
}

const BG = '#0b0c10'
const INK = '#f2f3f5'
const DIM = '#9ba1ab'
const EMBER = '#ff9e64'

function num(n: number): string {
  return n.toLocaleString('ru-RU')
}

/**
 * Раскладка карточки. Ориентация задаёт всё остальное: у широкой OG числа
 * встают в строку, у вертикальной — в колонку под ником.
 */
export function CardImage({ data, wide }: { data: CardData; wide: boolean }) {
  // У вертикальной карточки обложек меньше, но они крупнее: пять штук на 1080
  // дают узкие полоски, по которым игру не узнать.
  const coverCount = wide ? 5 : 3
  const stripHeight = wide ? 150 : 300
  const coverWidth = (wide ? 1200 : 1080) / coverCount
  const covers = data.covers.slice(0, coverCount)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: BG,
        color: INK,
        fontFamily: 'Onest',
      }}
    >
      {/* лента обложек — единственный носитель «это конкретный человек» */}
      <div style={{ display: 'flex', height: stripHeight, opacity: 0.3, overflow: 'hidden' }}>
        {covers.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            width={coverWidth}
            height={stripHeight}
            style={{ width: coverWidth, height: stripHeight, objectFit: 'cover' }}
            alt=""
          />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: wide ? '48px 64px' : '56px 64px',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'JetBrains Mono',
            fontSize: 20,
            letterSpacing: 6,
            color: EMBER,
            marginBottom: 18,
          }}
        >
          IMBORED.CC · ПОРТРЕТ ИГРОКА
        </div>

        {/* Отступ большой намеренно: у кириллицы «р», «у», «д» уходят заметно
            ниже базовой линии и вылезают за границу строки, съедая margin.
            Замерено по пикселям: при marginBottom 30 живой зазор был 6px против
            38px ниже. Прибавка через lineHeight тут не помогает — она делится
            поровну сверху и снизу. */}
        <div style={{ fontSize: wide ? 76 : 84, lineHeight: 1.15, marginBottom: wide ? 60 : 34 }}>
          {data.name.slice(0, 22)}
        </div>

        {data.archetypes.length > 0 && (
          <div style={{ fontSize: 30, color: DIM, marginBottom: wide ? 30 : 44 }}>
            {data.archetypes.join(' · ')}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: wide ? 'row' : 'column',
            marginTop: wide ? 8 : 0,
          }}
        >
          <Stat value={num(data.totalHours)} caption="часов сыграно" wide={wide} />
          <Stat value={num(data.gamesCount)} caption="игр в библиотеке" wide={wide} />
          <Stat value={num(data.unplayedCount)} caption="так и не запущены" wide={wide} />
        </div>

        {/* Одной строкой, а не склейкой из выражений: satori требует явный
            display:flex у любого div с несколькими детьми, и смешанный текст
            роняет рендер целиком. */}
        {data.topGame && data.topGame.sharePercent >= 25 && (
          <div style={{ fontSize: 22, color: DIM, marginTop: wide ? 30 : 44 }}>
            {`${data.topGame.sharePercent}% всего времени — «${data.topGame.name.slice(0, 34)}»`}
          </div>
        )}
      </div>

      {/* Подвал: у вертикальной карточки он закрывает пустой низ, у широкой
          просто подписывает источник. */}
      <div
        style={{
          display: 'flex',
          padding: '0 64px 44px',
          fontFamily: 'JetBrains Mono',
          fontSize: 20,
          color: EMBER,
          letterSpacing: 3,
        }}
      >
        IMBORED.CC
      </div>
    </div>
  )
}

function Stat({ value, caption, wide }: { value: string; caption: string; wide: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        marginRight: wide ? 72 : 0,
        marginBottom: wide ? 0 : 22,
      }}
    >
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: wide ? 54 : 62, color: INK }}>
        {value}
      </div>
      <div style={{ fontSize: 20, color: DIM, marginTop: 4 }}>{caption}</div>
    </div>
  )
}
