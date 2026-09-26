import { unstable_cache } from 'next/cache'
import Link from 'next/link'
import { Ambient } from '@/components/Ambient'
import { GameCardBody } from '@/components/GameCard'
import { Icon } from '@/components/Icon'
import { Eyebrow } from '@/components/Labels'
import { topCatalogGames } from '@/lib/db'
import { dayKey } from '@/lib/forgotten'
import { hashString, mulberry32 } from '@/lib/daily'
import { getDb } from '@/lib/server'

/**
 * 404 в языке продукта. Раньше notFound() из /game/[appid] проваливался
 * в стоковую страницу Next — единственный экран без нашей вёрстки.
 *
 * Теперь это не извинение, а дверь, и у двери есть створки.
 *
 * Сюда попадают двумя путями, и оба про игры: по битой ссылке на карточку
 * (игру убрали из каталога или переиздали) и с опечаткой в адресе. В обоих
 * случаях человек шёл ЗА ИГРОЙ. Текст это и обещал — «зато есть, во что
 * поиграть», — но страница не давала ничего, кроме кнопки «Подобрать игру»,
 * которая гостя без подключённой библиотеки разворачивает на лендинг. Полка
 * из настоящих карточек каталога — единственное, что здесь можно предложить
 * прямо, без входа и без объяснений.
 *
 * Заодно это разводит 404 и экран ошибки, которые до сих пор были одной и той
 * же центрированной стеклянной карточкой. Разводит не оформлением, а
 * содержанием: на 404 база жива и ей можно доверять, а на экране аварии —
 * нет, и там полке взяться неоткуда.
 */

/** Один ряд. Больше — это уже витрина, а человек сюда не за витриной пришёл. */
const SHELF = 4

/** Из скольких верхних карточек выбираем ряд дня. */
const POOL = 24

/**
 * Верх каталога живёт в кэше Next сутки.
 *
 * Раньше каждый рендер 404 шёл в базу. Статическая 404 для опечатки в адресе
 * собирается один раз на сборке, но notFound() из динамических страниц —
 * чужой steamid в /compat и /portrait (они force-dynamic), несуществующий
 * appid в /game — рендерит эту страницу заново, и каждый такой рендер платил
 * за полку отдельным запросом к Turso. Ответ у запроса один на всех и
 * меняется медленно: верх по числу отзывов неделями стоит на месте. Сутки —
 * ровно срок ряда дня ниже, так что свежее полке и не нужно.
 *
 * В кэше только выборка, а перемешивание — снаружи, на каждом рендере: ряд
 * по-прежнему меняется в свою полночь, а не тогда, когда истёк кэш.
 *
 * Пустую выборку не кэшируем: бросок не даёт unstable_cache её запомнить, а
 * shelf() ниже превращает его в пустую полку. Иначе сборка на пустой базе
 * (превью со своей свежей базой) заморозила бы 404 без полки на сутки.
 *
 * unstable_cache, а не "use cache", — по той же причине, что в
 * lib/whatsnewcache.ts: директиве нужен cacheComponents на всё приложение.
 */
const cachedTop = unstable_cache(
  async (limit: number) => {
    // getDb внутри: объект соединения в ключ кэша не сериализуется
    const games = await topCatalogGames(await getDb(), limit)
    if (games.length === 0) throw new Error('каталог пуст — полку не кэшируем')
    return games
  },
  ['notfound-shelf:v1'],
  { revalidate: 86_400 },
)

async function shelf() {
  try {
    const games = await cachedTop(POOL)
    if (games.length <= SHELF) return games
    /*
     * Ряд меняется раз в сутки, а не при каждом заходе: у страницы ошибок
     * должно быть постоянное лицо в пределах одного визита — иначе возврат
     * назад показывает другие игры и читается как ещё один сбой. Тот же
     * приём и тот же генератор, что у «Игры дня».
     */
    const rnd = mulberry32(hashString(`404:${dayKey(new Date())}`))
    const pool = [...games]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool.slice(0, SHELF)
  } catch {
    // База молчит — страница обязана открыться всё равно. 404 без полки
    // остаётся ровно тем, чем был до этой правки, и это не поломка.
    return []
  }
}

export default async function NotFound() {
  const games = await shelf()

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-5 pt-32 pb-16 text-center">
        <div className="flex flex-col items-center gap-4 anim-reveal">
          {/* «404» крупно, как титр: цифра — это и есть новость экрана, а
              знак сайта уже стоит в шапке */}
          <p aria-hidden className="nf-code">404</p>
          <Eyebrow tone="faint" className="sr-only">Ошибка 404</Eyebrow>
          <h1 className="font-display text-display-md">Такой страницы нет</h1>
          <p className="max-w-md leading-relaxed text-dim">
            Ссылка битая или игру убрали из каталога. Бывает — зато есть, во что поиграть.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3 anim-rise">
          <Link
            href="/quiz"
            className="btn-ember px-6 py-3"
          >
            Подобрать игру
          </Link>
          <Link href="/" className="btn-glass">
            <Icon name="home" size={18} />
            На главную
          </Link>
        </div>

        {games.length > 0 && (
          <section className="w-full anim-rise" style={{ animationDelay: '120ms' }}>
            <Eyebrow className="mb-3">Из каталога</Eyebrow>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4">
              {games.map((g) => (
                <Link key={g.appid} href={`/game/${g.appid}`} className="game-card block text-left">
                  <GameCardBody
                    appid={g.appid}
                    name={g.name}
                    headerImage={g.headerImage}
                    art={g.art}
                    sizes="(min-width: 768px) 25vw, 50vw"
                  />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
