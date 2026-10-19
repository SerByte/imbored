import { cache } from 'react'
import type { GameArtUrls } from '@/lib/art'
import { getGameNews, getGamesMetaLite, type StoredNews } from '@/lib/db'
import type { Locale } from '@/lib/i18n'
import { isStoredPatch } from '@/lib/news'
import { newsTitleOn } from '@/lib/newspage'
import { archiveItems, PATCH_ARCHIVE_LIMIT, type ArchiveItem } from '@/lib/patcharchive'
import { getDb } from '@/lib/server'
import type { GameMeta } from '@/lib/types'

export type PatchArchive = {
  appid: number
  game: {
    name: string
    headerImage: string | null
    art: GameArtUrls | null
    /** Живая игра каталога — тот же признак, по которому карточка игры идёт в индекс */
    listed: boolean
  }
  /** Патчи, свежие первыми, — все, что держит ретенция (PATCH_ARCHIVE_LIMIT) */
  items: ArchiveItem[]
}

/**
 * Жива ли игра в каталоге — то же условие, по которому её карточка стоит без
 * noindex (app/[lang]/game/[appid]/page.tsx, «мёртвая»): курация не отсеяла,
 * серия не отдала сиквелу, теги есть. ALIVE_POOL той же строкой, только по
 * разобранной мете.
 */
function listedGame(meta: GameMeta): boolean {
  return meta.alive !== false && meta.supersededBy === undefined && Object.keys(meta.tags).length > 0
}

/**
 * Патч на языке страницы — до archiveItems, чтобы и ссылка заголовка
 * (indexedNewsPath) судила пересказ своего языка.
 *
 * Тем же правилом, что строка ленты карточки (cardNews в lib/gamepage) и
 * страница патча (loadPatch): на /en пересказ — только английский (tldrEn),
 * русского там нет вовсе (docs/i18n.md, п. 8), а заголовок — newsTitleOn
 * (titleEn, английский заголовок издателя или «{Game} update»). Без
 * английского пересказа страница патча на /en не в поиске — значит, и
 * заголовок архива ведёт туда только с ним. Русская страница — как лежит.
 */
function patchOn(p: StoredNews, gameName: string, locale: Locale): StoredNews {
  if (locale !== 'en') return p
  const item: StoredNews = { ...p, title: newsTitleOn(p, gameName, locale) }
  delete item.tldr
  delete item.tldrEn
  delete item.titleEn
  if (p.tldrEn) item.tldr = p.tldrEn
  return item
}

/**
 * Архив или null — на всё, чего страницы нет: кривой appid, игры нет в
 * каталоге (архиву нечего назвать), у игры нет ни одного патча.
 *
 * Патчи — тем же чтением и тем же отбором, что у ленты карточки игры
 * (loadGamePage в lib/gamepage): getGameNews, а за ним isStoredPatch — патч
 * ли запись по нынешнему правилу классификатора, а не по kind, записанному
 * правилом дня опроса. Иначе дорожная карта, записанная патчем до правки
 * lib/news, стояла бы здесь строкой с пересказом и ссылкой на свою страницу,
 * а та отдаёт ей 404 (loadPatch). Тела поэтому и читаются — правило смотрит
 * в заголовок и тело, и getGamePatchHeads без тел здесь не годится. Цена — до
 * тридцати блобов раз в сутки на архив (ISR), а не на каждый заход; дальше
 * загрузчика тела не идут — archiveItems их снимает.
 *
 * Отбор — до перевода (patchOn): правило читает заголовок издателя, а не
 * подпись страницы, и решает одинаково на обоих языках.
 *
 * Два чтения параллельно, оба по ключу: мета игры — одна строка, патчи — по
 * idx_news_app. cache — generateMetadata и страница рендерят один запрос,
 * база читается однажды; язык — в ключе вместе с адресом.
 */
export const loadArchive = cache(async (raw: string, locale: Locale = 'ru'): Promise<PatchArchive | null> => {
  const appid = Number(raw)
  if (!Number.isInteger(appid) || appid <= 0) return null
  const db = await getDb()
  const [metas, patches] = await Promise.all([
    getGamesMetaLite(db, [appid]),
    getGameNews(db, appid, PATCH_ARCHIVE_LIMIT).then((rows) => rows.filter(isStoredPatch)),
  ])
  const meta = metas.get(appid)
  if (!meta || !patches.length) return null
  return {
    appid,
    game: { name: meta.name, headerImage: meta.headerImage ?? null, art: meta.art ?? null, listed: listedGame(meta) },
    items: archiveItems(patches.map((p) => patchOn(p, meta.name, locale))),
  }
})
