import { getGamesMetaLite, getLatestSnapshot, getPersonaName } from '@/lib/db'
import { ogFonts, ogNum, OG_BG, OG_DIM, OG_EMBER, OG_INK } from '@/lib/og'
import { PosterWall, postersOf, WALL_POSTERS, WallShade } from '@/lib/ogcard'
import { CANVAS_TALL, CANVAS_WIDE, WALL_TALL, WALL_WIDE } from '@/lib/ogwall'
import { archetypeLabelOf, buildPortrait } from '@/lib/portrait'
import { getDb } from '@/lib/server'
import { buildWrapped } from '@/lib/wrapped'
import { gamesCaption, playedFact, unplayedCaption } from '@/lib/factcaptions'
import { tr, type Locale } from '@/lib/i18n'
import { quoted } from '@/lib/sharedpick'
import { playerName } from './portrait-text'

/**
 * Общая начинка для двух картинок: OG-превью 1200×630 и скачиваемой карточки
 * 1080×1350. Рисуется на сервере через next/og.
 *
 * Почему не canvas на клиенте: steamstatic не отдаёт CORS-заголовков, любая
 * обложка делает canvas tainted и toBlob() падает.
 *
 * Шрифты и палитра переехали в lib/og.ts — со второй карточкой (совместимость)
 * они перестали быть частной деталью портрета.
 */

export const fonts = ogFonts

export type CardData = {
  /**
   * Язык карточки — адреса, с которого её взяли (/en/portrait/…/card.png).
   * Едет в данных, а не отдельным пропом: подписи под числами решает
   * CardImage, и язык у них обязан быть тем же, что у ника и архетипов.
   */
  locale: Locale
  name: string
  /** Минуты, а не часы: подпись решает playedFact, как у героя портрета */
  totalMinutes: number
  gamesCount: number
  unplayedCount: number
  archetypes: string[]
  /** Постеры стены — data-URI (ogPoster), самые наигранные первыми */
  posters: string[]
  topGame: { name: string; sharePercent: number } | null
  /**
   * Время скрыто настройками Steam (lib/playtime.ts): вместо «0 часов» и
   * «0 не запущено» — одно «время скрыто», а стена — из всей библиотеки.
   */
  playtimeHidden: boolean
}

export async function loadCardData(steamid: string, locale: Locale = 'ru'): Promise<CardData | null> {
  if (!/^\d{17}$/.test(steamid)) return null
  const db = await getDb()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return null

  const games = snapshot.games
  const metas = await getGamesMetaLite(
    db,
    games.map((g) => g.appid),
  )
  const metaOf = (id: number) => metas.get(id)
  const portrait = buildPortrait(games, metaOf)
  const wrapped = buildWrapped(games, metaOf)

  // Стена — самые наигранные, как у героя портрета на сайте. При скрытом
  // времени наигранных нет ни одной, и стена берёт библиотеку как есть:
  // пустая карточка сказала бы «в библиотеке ничего», а это неправда
  const hidden = wrapped.playtimeHidden
  const played = games
    .filter((g) => g.appid > 0 && (hidden || g.playtimeForever > 0))
    .sort((a, b) => b.playtimeForever - a.playtimeForever)
    .slice(0, WALL_POSTERS)
  const posters = await postersOf(played, metaOf)

  return {
    locale,
    // Ник — тем же правилом, что у страницы: демо-ник и запасное имя на языке карточки
    name: playerName(steamid, await getPersonaName(db, steamid), locale),
    totalMinutes: wrapped.totalMinutes,
    gamesCount: wrapped.gamesCount,
    unplayedCount: wrapped.unplayedCount,
    // label у архетипа всегда русский — подпись по ключу (lib/archetypes)
    archetypes: portrait.archetypes
      .filter((a) => a.known)
      .slice(0, 2)
      .map((a) => archetypeLabelOf(a, locale)),
    posters,
    topGame: portrait.facts.topGame,
    playtimeHidden: hidden,
  }
}

const BG = OG_BG
const INK = OG_INK
const DIM = OG_DIM
const EMBER = OG_EMBER

/**
 * Раскладка карточки. Ориентация задаёт всё остальное: у широкой OG числа
 * встают в строку, у вертикальной — в колонку под ником.
 *
 * Библиотека — стеной постеров во весь холст, текст — снизу, поверх скрима:
 * раньше здесь была полоска из пяти обложек на прозрачности 0.3, и карточка
 * в чате читалась как таблица, а не как чей-то портрет.
 */
export function CardImage({ data, wide }: { data: CardData; wide: boolean }) {
  const locale = data.locale
  const num = (n: number) => ogNum(n, locale)
  const played = playedFact(data.totalMinutes, locale)
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: BG,
        color: INK,
        fontFamily: 'Manrope',
        overflow: 'hidden',
      }}
    >
      <PosterWall posters={data.posters} spec={wide ? WALL_WIDE : WALL_TALL} />
      <WallShade canvas={wide ? CANVAS_WIDE : CANVAS_TALL} />

      <div
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          bottom: wide ? 44 : 56,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            fontFamily: 'Manrope',
            fontSize: 20,
            letterSpacing: 6,
            color: EMBER,
            marginBottom: 18,
          }}
        >
          {tr(locale, { ru: 'IMBORED.CC · ПОРТРЕТ ИГРОКА', en: 'IMBORED.CC · PLAYER PORTRAIT' })}
        </div>

        {/* Отступ большой намеренно: у кириллицы «р», «у», «д» уходят заметно
            ниже базовой линии и вылезают за границу строки, съедая margin.
            Замерено по пикселям: при marginBottom 30 живой зазор был 6px против
            38px ниже. Прибавка через lineHeight тут не помогает — она делится
            поровну сверху и снизу. */}
        <div style={{ fontSize: wide ? 72 : 84, lineHeight: 1.15, marginBottom: wide ? 26 : 34 }}>
          {data.name.slice(0, 22)}
        </div>

        {data.archetypes.length > 0 && (
          <div style={{ fontSize: wide ? 28 : 30, color: DIM, marginBottom: wide ? 26 : 44 }}>
            {data.archetypes.join(' · ')}
          </div>
        )}

        {/* Числа строкой и в сторис: колонкой они поднимали текст на полкарточки и прятали стену */}
        {data.playtimeHidden ? (
          <div style={{ display: 'flex' }}>
            <Stat value={num(data.gamesCount)} caption={gamesCaption(data.gamesCount, locale)} wide={wide} />
            <Stat
              value={tr(locale, { ru: 'скрыто', en: 'hidden' })}
              caption={tr(locale, { ru: 'время в играх', en: 'playtime' })}
              wide={wide}
            />
          </div>
        ) : (
          <div style={{ display: 'flex' }}>
            <Stat value={num(played.value)} caption={played.caption} wide={wide} />
            <Stat value={num(data.gamesCount)} caption={gamesCaption(data.gamesCount, locale)} wide={wide} />
            <Stat
              value={num(data.unplayedCount)}
              caption={unplayedCaption(data.unplayedCount, locale)}
              wide={wide}
            />
          </div>
        )}

        {/* Одной строкой, а не склейкой из выражений: satori требует явный
            display:flex у любого div с несколькими детьми, и смешанный текст
            роняет рендер целиком. */}
        {!wide && data.topGame && data.topGame.sharePercent >= 25 && (
          <div style={{ fontSize: 22, color: DIM, marginTop: 22 }}>
            {tr(locale, {
              ru: `${data.topGame.sharePercent}% всего времени — «${data.topGame.name.slice(0, 34)}»`,
              en: `${data.topGame.sharePercent}% of all playtime — ${quoted(data.topGame.name.slice(0, 34), 'en')}`,
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ value, caption, wide }: { value: string; caption: string; wide: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginRight: wide ? 72 : 56 }}>
      <div style={{ fontFamily: 'Manrope', fontSize: wide ? 54 : 64, color: INK }}>{value}</div>
      <div style={{ fontSize: wide ? 20 : 22, color: DIM, marginTop: 4 }}>{caption}</div>
    </div>
  )
}
