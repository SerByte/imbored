import Link from 'next/link'
import { Ambient } from '@/components/Ambient'
import { GameArt } from '@/components/GameArt'
import { Eyebrow } from '@/components/Labels'
import { LogoMark } from '@/components/Logo'
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

async function shelf() {
  try {
    const games = await topCatalogGames(await getDb(), POOL)
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
          <LogoMark size={48} />
          <Eyebrow tone="faint">Ошибка 404</Eyebrow>
          <h1 className="font-display text-display-md">Такой страницы нет</h1>
          <p className="max-w-md leading-relaxed text-dim">
            Ссылка битая или игру убрали из каталога. Бывает — зато есть, во что поиграть.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3 anim-rise">
          <Link
            href="/quiz"
            className="rounded-[14px] bg-ember px-6 py-3 font-semibold text-on-ember transition hover:brightness-110"
          >
            Подобрать игру
          </Link>
          <Link href="/" className="rounded-[14px] glass glass-hover px-6 py-3 text-sm">
            На главную
          </Link>
        </div>

        {games.length > 0 && (
          <section className="w-full anim-rise" style={{ animationDelay: '120ms' }}>
            <Eyebrow className="mb-3">Из каталога</Eyebrow>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {games.map((g) => (
                <Link
                  key={g.appid}
                  href={`/game/${g.appid}`}
                  className="library-tile glass glass-hover overflow-hidden rounded-[14px] text-left"
                >
                  <GameArt
                    appid={g.appid}
                    name={g.name}
                    headerImage={g.headerImage}
                    art={g.art}
                    sizes="(min-width: 768px) 25vw, 50vw"
                    className="aspect-[460/215] w-full object-cover"
                  />
                  <div className="truncate p-3 text-sm font-semibold leading-tight">{g.name}</div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
