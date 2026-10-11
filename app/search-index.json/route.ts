import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { encodeSearchIndex, SEARCH_INDEX_MAX } from '@/lib/catalogsearch'
import { searchIndexGames } from '@/lib/db'
import { getDb } from '@/lib/server'

/**
 * Индекс «Найти игру»: номер и название каждой игры с карточкой — для поиска
 * по каталогу прямо в браузере (lib/catalogsearch, components/CatalogSearch).
 *
 * Статический, с перегенерацией раз в сутки, как RSS ленты
 * (app/whatsnew/feed.xml): GET-ручки по умолчанию не кэшируются вовсе (docs:
 * route handlers, Caching), и каждый, кто открыл поиск, будил бы функцию и
 * читал из базы весь каталог. Так — одна выборка в сутки и ни одного вызова
 * функции на набор: каждая клавиша ищет в браузере. Число — литералом:
 * revalidate обязан читаться статически.
 *
 * ВЕС. Замер по локальной копии каталога, 5816 живых игр: 172 КБ сырыми,
 * 76 КБ gzip, 66 КБ brotli — 13 байт gzip и 11 br на игру, то есть на 5.6
 * тысячи игр ~74 КБ gzip и ~64 КБ br. Это вес одной обложки, и платит его
 * только тот, кто открыл поиск: страница его не грузит (lib/catalogindex).
 * Названия — почти весь вес (47 КБ br из 66), номера — остальное; колонки
 * вместо пар сэкономили 7 КБ gzip (lib/catalogsearch, SearchIndexWire). На
 * локальной базе в тысячу игр — 14 КБ gzip.
 *
 * ЗАПИСЬ ISR. ~172 КБ — около двадцати двух блоков по 8 КБ, и пишутся они,
 * только когда вывод разошёлся с прошлым (lib/gamecache — лимит Hobby
 * выбран). Порядок по отзывам сдвигается почти каждый день, так что это ~650
 * блоков в месяц из двухсот тысяч — меньше, чем сорок карточек игр.
 */
export const dynamic = 'force-static'
export const revalidate = 86_400

/**
 * Строки или пустой индекс — но пустой только на сборке. На сборке без базы
 * getDb бросает сам (нет TURSO_DATABASE_URL), и пустой индекс лучше упавшего
 * build. При перегенерации ошибка уходит наружу намеренно: упавший рендер ISR
 * оставляет вчерашний индекс, а пойманный закэшировал бы пустой на сутки —
 * поиск сутки не находил бы ничего. Тот же довод, что у карты сайта.
 *
 * Пустой индекс со сборки ISR тоже держит до суток, и браузер читает его
 * отказом, а не пустым каталогом (readSearchIndex → null): «Каталог не
 * загрузился» с кнопкой повтора, а не «Ничего не нашлось» на «Dota 2».
 */
async function readIndex(): Promise<Array<{ appid: number; name: string }>> {
  try {
    return await searchIndexGames(await getDb(), SEARCH_INDEX_MAX)
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('search-index: каталог недоступен на сборке, индекс собран пустым —', String(err))
    return []
  }
}

export async function GET(): Promise<Response> {
  return Response.json(encodeSearchIndex(await readIndex()))
}
