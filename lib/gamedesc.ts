import type { Locale } from './i18n'
import { OTHER_STORE_EN } from './otherstores'
import { textLang } from './textlang'
import type { GameMeta } from './types'

/**
 * Описание игры и страница её магазина — на языке страницы.
 *
 * Одно правило на все места, где описание читают: карточка игры, её meta
 * description и микроразметка, «О чём игра» у героя выдачи и полка жанра.
 * Пока правило жило у каждого своё, оно и разъезжалось бы у каждого своё — а
 * ошибка тут видна сразу: русский абзац на /en или английский хвост посреди
 * русского героя.
 *
 * Модуль чистый: ни базы, ни сети. Тянет только наложение пула других
 * магазинов (lib/otherstores, данные) и textLang — оба годятся и клиенту.
 */

type DescribedMeta = Pick<GameMeta, 'appid' | 'shortDescription' | 'shortDescriptionEn'>

/**
 * Описание на языке locale; null — описания на этом языке нет.
 *
 * ru — то, что лежит в shortDescription, как и раньше (там бывает и
 * английский текст прогрева): русские потребители сами решают, годится ли он
 * им, — «О чём игра» берёт только русский (aboutLine в lib/cards), а
 * карточка игры показывает и английский, с lang="en".
 *
 * en — только английский текст, по убыванию надёжности:
 *   1. shortDescriptionEn — английское описание магазина (прогрев и крон
 *      карточек ходят в GetItems по-английски, lib/catalog);
 *   2. shortDescription, если сам он английский — до первого прохода крона
 *      там и лежит английский текст прогрева;
 *   3. наложение пула других магазинов (OTHER_STORE_EN) — у их записей
 *      описание русское, а английское живёт в коде, не в базе;
 *   4. null: русского на /en не показываем (docs/i18n.md), блок молчит.
 * «Английский» — большинство букв латиница (textLang), а не «нет кириллицы»:
 * китайский текст студии на /en был бы таким же чужим.
 */
export function descriptionFor(meta: DescribedMeta | null | undefined, locale: Locale): string | null {
  if (!meta) return null
  if (locale !== 'en') return meta.shortDescription?.trim() ? meta.shortDescription : null
  if (meta.shortDescriptionEn?.trim()) return meta.shortDescriptionEn
  const own = meta.shortDescription
  if (own?.trim() && textLang(own) === 'en') return own
  return OTHER_STORE_EN[meta.appid]?.shortDescription ?? null
}

/**
 * Страница игры в её магазине на языке locale; null — своей страницы нет
 * (игра Steam: вызывающий собирает адрес Steam сам, он от языка не зависит —
 * Steam выбирает язык по аккаунту).
 *
 * Отличается только у пула других магазинов (appid < 0): в записи пула —
 * русская страница магазина, английская — в наложении OTHER_STORE_EN. Нет
 * пары — та же ссылка, что у русской версии: магазин лучше без языка, чем
 * никакой.
 */
export function storeUrlFor(
  meta: Pick<GameMeta, 'appid' | 'storeUrl'> | null | undefined,
  locale: Locale,
): string | null {
  if (!meta) return null
  if (locale === 'en' && meta.appid < 0) return OTHER_STORE_EN[meta.appid]?.storeUrl ?? meta.storeUrl ?? null
  return meta.storeUrl ?? null
}
