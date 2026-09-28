import { dealsEndedBetween, getCatalogMeta, setCatalogMeta, type Db, type GamePageRow } from './db'
import { discountOf, discountTrustedUntil, trustedPrice } from './discount'

/**
 * Кэш карточки игры: сколько она живёт, что пререндерится и когда её сбросить.
 *
 * Всё это про ISR Writes. На Hobby их двести тысяч блоков по 8 КБ за окно, и
 * замер от 28 сентября — 229 тысяч, то есть выбрано сверх лимита. Карточек в
 * карте сайта пять тысяч, и каждая запись — это HTML (~88 КБ) плюс RSC
 * (~48 КБ), около семнадцати блоков. Пишет Vercel в трёх случаях: пререндер на
 * сборке, первый рендер адреса и перегенерация, вывод которой РАЗОШЁЛСЯ с
 * прошлым («When revalidation runs and the content hasn't changed from the
 * previous version, no ISR write units are incurred», документация Vercel).
 *
 * Отсюда три рычага, и все три здесь:
 *   • пререндер — только на продовой сборке и только верх каталога;
 *   • неделя жизни вместо суток — при стабильном выводе (см. докблок
 *     app/game/[appid]/page.tsx) это неделя без единой лишней записи;
 *   • точечный сброс, когда кроны поменяли данные карточки: так свежие pros/cons
 *     и патчи не ждут недели, а неизменённые карточки не перерисовываются.
 */

/**
 * Жизнь карточки в кэше, секунды. Литерал `revalidate` в page.tsx и
 * opengraph-image.tsx обязан быть тем же числом — Next читает его только
 * литералом, импорт он не разберёт. Совпадение сверяет сторож рядом со
 * страницей (app/game/[appid]/page.test.ts).
 */
export const GAME_PAGE_REVALIDATE_SEC = 604_800

/**
 * Сколько карточек пререндерится на сборке — верх каталога по sitemapGames.
 *
 * Было пятьсот, и это пять сотен записей по семнадцать блоков на КАЖДУЮ
 * сборку — около 8.5 тысячи блоков, придёт на карточку хоть кто-нибудь или
 * нет. При деплое раз в день это больше, чем весь месячный лимит.
 *
 * Пререндер окупается там, где адрес и так посетят: тогда запись всё равно
 * случилась бы, просто позже и холодным рендером. Для верхней сотни это
 * почти наверняка — на неё больше всего внешних ссылок, её первой обходят
 * краулеры. Хвост дешевле досоздать по требованию (dynamicParams по
 * умолчанию true): первый заход платит холодным рендером, который и так
 * укладывается в «хорошо» (perf-11 аудита), а запись случается, только если
 * адрес кому-то понадобился.
 */
export const PRERENDER_TOP = 100

/**
 * Пререндерить ли карточки на этой сборке. Только прод: превью делили с
 * продом базу (TURSO_* заведены на Production и Preview) и за три дня 45 раз
 * пререндерили те же пятьсот карточек — ради деплоев, которые никто не
 * открывал. Локальной сборке пререндер тоже ни к чему, а базы у неё может не
 * быть вовсе.
 */
export function prerenderAtBuild(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production'
}

/** Адрес карточки — тот, под которым её кэширует ISR и сбрасывает revalidatePath */
export function gamePagePath(appid: number): string {
  return `/game/${appid}`
}

/**
 * Пометить карточки к перегенерации — каждую один раз.
 *
 * revalidate — revalidatePath из next/cache; аргументом, а не импортом, по
 * тому же доводу, что у announceFreshPatches (lib/indexnow): вне сервера Next
 * настоящий revalidatePath бросает, а здесь важно только, какие адреса.
 *
 * Что это стоит: revalidatePath ничего не рендерит сам (docs Next,
 * revalidatePath.md: из Route Handler путь помечается, перегенерация — при
 * следующем заходе). Незаходимая карточка не стоит ничего, а зашедшая
 * пишется, только если её вывод и правда поменялся.
 *
 * Возвращает, сколько адресов помечено.
 */
export function revalidateGamePages(
  appids: Iterable<number>,
  revalidate: (path: string) => void,
): number {
  const seen = new Set<number>()
  // Отрицательные appid — тоже карточки (кураторский пул других магазинов)
  for (const appid of appids) if (Number.isInteger(appid) && appid !== 0) seen.add(appid)
  for (const appid of seen) revalidate(gamePagePath(appid))
  return seen.size
}

/**
 * Отпечаток строки карточки: не поменялся он — не поменялось и всё, что
 * карточка берёт из этой строки. Им крон карточек (lib/pagejob) решает,
 * какие адреса сбросить. Обратное не обязано быть точным: лишний сброс
 * стоит перегенерации при заходе, но не записи, если вывод тот же.
 *
 * Строка берётся целиком (getGamePageRows): мета с семантикой, сводка отзывов,
 * pros/cons. Узкие проверки «что записал срез» не годятся — срез пишет всё
 * безусловно (кадры пачкой, семантику всегда, сводку при каждом ответе), и
 * «записал» у него значит «трогал», а не «поменял».
 *
 * Единственное исключение — priceAt. Срез датирует им каждый ответ
 * appdetails, а карточка берёт из метки только выводы: верить ли цене и
 * скидке (trustedPrice, discountOf) и до какого момента — discountTrustedUntil,
 * по которому страница гасит строку цены (ShownUntil). В отпечатке стоят эти
 * выводы, а не сама метка. У цены без скидки и у скидки со сроком от Steam
 * замер не виден вовсе, и новая метка не должна делать карточку изменённой.
 * У скидки без срока виден: свежий замер отодвигает момент, когда страница
 * спрячет цену, — и карточку, собранную по старому замеру, надо сбросить,
 * иначе она погасит ещё живую скидку.
 */
export function cardRowPrint(row: GamePageRow, nowSec: number): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { priceAt, ...meta } = row.meta
  return JSON.stringify({
    meta,
    price: trustedPrice(row.meta, nowSec),
    deal: discountOf(row.meta, nowSec),
    until: discountTrustedUntil(row.meta, nowSec),
    reviewsSummary: row.reviewsSummary,
    prosCons: row.prosCons,
  })
}

/**
 * Итог звена крона — в отметку, карточки из него — в сброс.
 *
 * Список карточек нужен роуту, а не отметке: runChain кладёт итог звена в
 * *_last_slice целиком, и у новостей там лежали бы десятки appid на звено —
 * шум в catalog_meta и в выводе /api/cron/health. Отметке остаётся число
 * помеченных адресов; роут складывает его и в «итого» запуска.
 */
export function resetSliceCards<T extends { cards: number[] }>(
  slice: T,
  revalidate: (path: string) => void,
): Omit<T, 'cards'> & { сброшено: number } {
  const { cards, ...rest } = slice
  return { ...rest, сброшено: revalidateGamePages(cards, revalidate) }
}

/** Ключ в catalog_meta: докуда крон карточек прошёл погасшие скидки (unix-секунды) */
export const DEALS_SWEPT_KEY = 'pages_deals_swept_through'

/**
 * Сбросить карточки, чья скидка погасла с прошлого прохода.
 *
 * Карточку собирают со скидкой и держат неделю. Людям строку цены гасит
 * клиент в срок (ShownUntil), а разметка остаётся HTML как есть: Offer с
 * акционной ценой — у скидки без срока от Steam ещё и без priceValidUntil —
 * висел бы в выдаче до недельной перегенерации, хотя видимая страница уже
 * молчит. Правило lib/jsonld «разметка говорит то же, что видно» держится,
 * только если карточку перегенерируют вскоре после конца скидки. Это и
 * делает проход: окно расхождения — от конца скидки до ближайшего запуска
 * крона карточек, то есть в пределах суток, а не недели.
 *
 * Окно — (прошлый проход, сейчас], и отметка двигается только после сброса:
 * упало чтение — окно целиком достанется следующему запуску. Длиннее недели
 * окно не бывает: карточка старше недели перегенерируется сама, а после
 * долгой паузы крона (килл-свитч) проход не должен сбрасывать скидки всего
 * каталога за месяц.
 *
 * Что стоит: пометка ничего не рендерит (revalidateGamePages), запись
 * случается у карточки, на которую зашли, и она оправдана — скидка с
 * карточки пропадает.
 *
 * Скидки, погасшие в базе раньше срока (свежий ответ Steam без скидки), сюда
 * не попадают — в строке скидки уже нет. Такую карточку сбрасывает срез
 * карточек по отпечатку (cardRowPrint), если ответ записал он. Ценовой
 * прогрев по заходам (lib/deals) карточек не сбрасывает: такая карточка
 * держит старую скидку в разметке до своей недели, а людям её гасит клиент
 * в прежний срок.
 *
 * Возвращает, сколько адресов помечено.
 */
export async function revalidateEndedDeals(
  db: Db,
  revalidate: (path: string) => void,
  nowSec: number,
): Promise<number> {
  const prev = Number(await getCatalogMeta(db, DEALS_SWEPT_KEY))
  const after = Math.max(Number.isFinite(prev) ? prev : 0, nowSec - GAME_PAGE_REVALIDATE_SEC)
  if (after >= nowSec) return 0
  const n = revalidateGamePages(await dealsEndedBetween(db, after, nowSec), revalidate)
  await setCatalogMeta(db, DEALS_SWEPT_KEY, String(nowSec))
  return n
}
