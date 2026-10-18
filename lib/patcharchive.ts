/**
 * Архив обновлений игры — /game/<appid>/news.
 *
 * Зачем. Карточка игры показывает восемь последних патчей (CARD_PATCHES), а
 * хранится их больше — ретенция держит тридцать последних постов игры
 * (NEWS_KEEP в lib/newsjob). Всё, что старше восьмого, не было видно ниоткуда:
 * пересказы этих патчей лежали в базе, а страница патча держалась на карте
 * сайта, которая знает только девяносто дней. «Что изменилось, пока я не
 * играл» — вопрос ровно про них, и отвечать на него нужно одним списком, а не
 * восемью строками и поиском по Steam. Заодно у запроса «обновления CS2» есть
 * один постоянный адрес вместо десятков одинаковых заголовков Steam (F78
 * аудита: все патчи CS2 называются «Обновление Counter-Strike 2»).
 *
 * Честно о глубине: тридцать ПОСТОВ, а не патчей, и у часто патчащихся игр
 * это месяц-два. Страница так и говорит — и ведёт за остальным в Steam.
 *
 * Что считается патчем, решает не этот модуль. Строки приходят тем же
 * чтением и тем же отбором, что лента карточки игры: getGameNews, а за ним
 * isStoredPatch (lib/news) — нынешнее правило классификатора, то же, по
 * которому страница патча отдаёт 404 (app/game/[appid]/news/load.ts). Ссылка
 * заголовка — из indexedNewsPath (lib/newspage). Поправят классификацию там —
 * архив пойдёт за ней сам, второго правила здесь нет.
 *
 * Модуль клиентобезопасный и без базы: правила страницы и карты сайта, тексты
 * и группировка. Читают его страница архива, её разметка и тесты.
 */
import { clip, DESCRIPTION_MAX } from './clip'
import type { StoredNews } from './db'
import { dateLabel } from './freshness'
import { indexedNewsPath } from './newspage'
import { plural } from './plural'

/**
 * Сколько патчей читает архив — все, что держит ретенция (NEWS_KEEP в
 * lib/newsjob; равенство сторожит lib/patcharchive.test.ts). Числом, а не
 * импортом: newsjob тянет за собой модель и опрос Steam, а страница — нет.
 */
export const PATCH_ARCHIVE_LIMIT = 30

/**
 * С какого числа пересказанных патчей архив идёт в поиск и в карту сайта.
 *
 * Своё у архива — пересказы: без них это список заголовков Steam с датами,
 * копия ленты новостей игры в Steam, и в выдаче он проигрывал бы ей по
 * определению. Один-два пересказа — это ещё страница патча, а не архив.
 */
export const PATCH_ARCHIVE_MIN = 3

/**
 * Сколько патчей стоит на карточке игры (getGameNews в lib/gamepage). Ссылка
 * на архив стоит там, только когда карточка показала их столько: меньше —
 * значит, все патчи уже на карточке, и архив повторил бы её строки.
 */
export const CARD_PATCHES = 8

/** Адрес архива — под карточкой игры, рядом со страницами патчей */
export function patchArchivePath(appid: number): string {
  return `/game/${appid}/news`
}

/**
 * Строка архива — то, что видно в списке: дата, масштаб, пересказ, заголовок
 * и оригинал в Steam, — и, если страница патча в поиске, её адрес. Тела нет:
 * строке оно не нужно, оно живёт на странице патча.
 */
export type ArchiveItem = Pick<StoredNews, 'gid' | 'title' | 'url' | 'publishedAt' | 'scale' | 'tldr'> & {
  /**
   * Адрес страницы патча — только у той, что в поиске (indexedNewsPath): как
   * у заголовка на карточке игры, краулера не зовём туда, откуда его выставит
   * noindex. null — заголовок текстом, рядом ссылка на оригинал в Steam.
   */
  href: string | null
}

/** Патчи игры, уже отобранные как патчи (isStoredPatch), — в строки архива */
export function archiveItems(patches: readonly StoredNews[]): ArchiveItem[] {
  return patches.map((p) => ({
    gid: p.gid,
    title: p.title,
    url: p.url,
    publishedAt: p.publishedAt,
    scale: p.scale,
    tldr: p.tldr,
    href: indexedNewsPath(p),
  }))
}

/**
 * Пускать ли архив в индекс: игра жива в каталоге (как у карточки и
 * страницы патча — newsIndexable) и пересказанных патчей, страницы которых
 * сами в поиске, не меньше PATCH_ARCHIVE_MIN.
 */
export function archiveIndexable(items: readonly ArchiveItem[], listed: boolean): boolean {
  return listed && items.filter((i) => i.href !== null).length >= PATCH_ARCHIVE_MIN
}

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const

export type ArchiveMonth = { key: string; label: string; items: ArchiveItem[] }

/**
 * Строки по месяцам, в порядке прихода (свежие первыми). Месяц — по UTC, как
 * дата в самой строке (dateLabel, lib/freshness): иначе патч от 30 сентября
 * 23:30 UTC стоял бы с датой «30 сентября» под «Октябрём». Название — своим
 * списком, а не toLocaleDateString: «октябрь 2026 г.» строчными и с «г.» —
 * не заголовок.
 */
export function archiveMonths(items: readonly ArchiveItem[]): ArchiveMonth[] {
  const out: ArchiveMonth[] = []
  for (const item of items) {
    const d = new Date(item.publishedAt * 1000)
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    const last = out[out.length - 1]
    if (last?.key === key) last.items.push(item)
    else out.push({ key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, items: [item] })
  }
  return out
}

/** <title> архива: имя игры — с него начинается запрос — и вопрос, ради которого ищут */
export function archiveTitle(gameName: string): string {
  return `Обновления «${gameName}» — что изменилось в патчах`
}

/**
 * meta description: сколько патчей и за какой срок, затем последний пересказ.
 *
 * Пересказ, а не заголовок: заголовок Steam у патчей одной игры часто один и
 * тот же (F78 аудита), а пересказ говорит, что изменилось. Пересказа нет ни
 * у одного — только счёт и срок, без пустого хвоста.
 */
export function archiveDescription(gameName: string, items: readonly ArchiveItem[]): string {
  const n = items.length
  const newest = items[0]
  const oldest = items[n - 1]
  // Год — один раз, в конце срока («с 3 августа по 12 октября 2026 г.»), и
  // у начала — только если он другой
  const sameYear =
    newest && oldest && new Date(newest.publishedAt * 1000).getUTCFullYear() === new Date(oldest.publishedAt * 1000).getUTCFullYear()
  const span =
    newest && oldest && n > 1
      ? ` — с ${dateLabel(oldest.publishedAt, { year: !sameYear })} по ${dateLabel(newest.publishedAt, { year: true })}`
      : newest
        ? ` — ${dateLabel(newest.publishedAt, { year: true })}`
        : ''
  // «2026 г.» уже кончается точкой — вторая была бы лишней
  const head = `${n} ${plural(n, 'патч', 'патча', 'патчей')} «${gameName}»${span}`.replace(/\.?$/, '.')
  const told = items.find((i) => i.tldr?.trim())
  const text = told
    ? `${head} Последний пересказ, ${dateLabel(told.publishedAt)}: ${told.tldr!.replace(/\s+/g, ' ').trim()}`
    : head
  return clip(text, DESCRIPTION_MAX) ?? text.slice(0, DESCRIPTION_MAX)
}
