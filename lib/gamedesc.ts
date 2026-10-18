import { hasCyrillic } from './cyrillic'
import type { Locale } from './i18n'
import { OTHER_STORE_EN } from './otherstores'
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
 * магазинов (lib/otherstores, данные) и hasCyrillic — оба годятся и клиенту.
 */

/**
 * Служебные слова английского и соседних латинских языков — признак языка,
 * которого буквы не дают: немецкий, испанский или французский текст студии
 * — та же латиница, что и английский. Только слова, которых в английском
 * описании почти не бывает (поэтому нет ни «die», ни «a», ни «in», ни
 * «do»): одно случайное («Los Santos») решения не меняет, см. isEnglishText.
 */
const EN_WORDS = new Set(
  'the and of to you your with for is are on as from this that it its into by or be can all their who will at'.split(' '),
)
const OTHER_WORDS = new Set(
  [
    // немецкий
    'der das und ein eine einen einem einer mit ist nicht für auf dem des zu von sich wie auch oder aus durch wird werden dein deine',
    // французский
    'le les et une du dans pour avec vous votre sur au aux qui ses sont leur cette pas',
    // испанский, португальский, итальянский
    'el los las y del con para por una un es su sus más como lo juego mundo os um uma com em da dos das não seu sua você jogo il gli della di che nel sono gioco',
    // польский, турецкий, нидерландский
    'się jest nie oraz dla gra ve bir ile bu için oyun het een van voor zijn wordt',
  ]
    .join(' ')
    .split(' '),
)

/**
 * Английский ли текст — то, чем /en вправе говорить, а не просто «чем его
 * читать».
 *
 * Не textLang из lib/textlang: там вопрос «каким голосом читать кусок», и
 * латиница против кириллицы его решает. Здесь вопрос «можно ли показать это
 * на английской странице», и у него три отказа, каждый с замера:
 *   1. хоть одна русская буква. «Tom Clancy's Rainbow Six® Siege X —
 *      тактический шутер.» по большинству букв латиница, но это русское
 *      описание, а русского на /en нет (docs/i18n.md);
 *   2. латиница — меньше восьми десятых всех букв. Китайский, японский или
 *      корейский текст студии кириллицы не содержит, а латиница в нём есть
 *      почти всегда («RPG», «Steam», «PvP») — по счёту «латиница против
 *      кириллицы» он выходил английским;
 *   3. служебных слов соседних латинских языков больше, чем английских, и
 *      их хотя бы два: немецкий и испанский текст — та же латиница.
 * Текст без единой буквы («1.0.3») описанием не считается.
 */
export function isEnglishText(text: string | null | undefined): boolean {
  const t = text?.trim()
  if (!t || hasCyrillic(t)) return false
  const letters = t.match(/\p{L}/gu)?.length ?? 0
  if (!letters) return false
  const latin = t.match(/\p{Script=Latin}/gu)?.length ?? 0
  if (latin / letters < 0.8) return false
  let en = 0
  let other = 0
  for (const w of t.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (EN_WORDS.has(w)) en++
    else if (OTHER_WORDS.has(w)) other++
  }
  return !(other >= 2 && other > en)
}

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
 * «Английский» — isEnglishText, и для слота тоже: слот пишут несколько
 * дорог (крон, прогрев, скрипты заливки), и проверка на чтении — последняя
 * дверь, которую ни одна из них не обойдёт.
 */
export function descriptionFor(meta: DescribedMeta | null | undefined, locale: Locale): string | null {
  if (!meta) return null
  if (locale !== 'en') return meta.shortDescription?.trim() ? meta.shortDescription : null
  if (isEnglishText(meta.shortDescriptionEn)) return meta.shortDescriptionEn!
  if (isEnglishText(meta.shortDescription)) return meta.shortDescription!
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
