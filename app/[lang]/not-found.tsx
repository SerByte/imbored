import type { Metadata } from 'next'
import Link from '@/components/Link'
import { Ambient } from '@/components/Ambient'
import { StaticGameCardBody } from '@/components/StaticGameCard'
import { Icon } from '@/components/Icon'
import { Eyebrow } from '@/components/Labels'
import { SearchLauncher } from '@/components/SearchLauncher'
import { topCatalogGames } from '@/lib/db'
import { dayKey } from '@/lib/forgotten'
import { hashString, mulberry32 } from '@/lib/daily'
import { toLocale, tr, type Locale } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n-server'
import { getDb } from '@/lib/server'
import { generateMetadata as rootMetadata } from './layout'

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
 * из настоящих карточек каталога — то, что здесь можно предложить прямо, без
 * входа и без объяснений.
 *
 * Полка стоит не на каждой 404. Её рисует только /_not-found — адрес вне
 * разделов и опечатка под русским разделом (app/global-not-found.tsx). 404
 * из notFound() страниц (/game/<нет такой>, /en/xyz) рисует граница ниже, и
 * там экран без полки: граница сидит в RSC каждой страницы сайта, и любой
 * запрос к базе в ней — это запрос в рендере каждой страницы. Подробно — у
 * shelf().
 *
 * А раз шёл за игрой — первая створка «Найти игру по названию»
 * (components/SearchLauncher): переизданную игру или адрес с опечаткой
 * человек находит по первым буквам названия, без входа так же. Строка
 * стоит в первой загрузке КАЖДОЙ страницы (эта 404 — граница not-found
 * корневого лэйаута), поэтому она — та же кнопка, что в шапке, а не свой
 * компонент: замер в докблоке SearchLauncher.
 *
 * Заодно это разводит 404 и экран ошибки, которые до сих пор были одной и той
 * же центрированной стеклянной карточкой. Разводит не оформлением, а
 * содержанием: на 404 база жива и ей можно доверять, а на экране аварии —
 * нет, и там полке взяться неоткуда.
 */

/** Один ряд. Больше — это уже витрина, а человек сюда не за витриной пришёл. */
const SHELF = 4

/** Из скольких верхних карточек выбираем ряд. */
const POOL = 24

/**
 * Полка — только у /_not-found, и базу она читает сама, без кэша Next.
 *
 * Здесь стоял unstable_cache({ revalidate: 86_400 }), а полку рисовала и
 * граница not-found ниже. Это был потолок срока для всего сайта. Границу
 * not-found корневого layout Next рисует вместе с КАЖДОЙ страницей под
 * app/[lang], и с нашедшейся тоже: готовым элементом в проп notFound у
 * LayoutRouter (next/dist/server/app-render/create-component-tree.js), то
 * есть внутри RSC страницы. А unstable_cache с числом в revalidate опускает
 * срок страницы, в чьём рендере выполнился, до своего, если свой короче
 * (next/dist/server/web/spec-extension/unstable-cache.js). Итог по манифесту
 * сборки: карточка игры с revalidate на неделю жила сутки и отвечала
 * s-maxage=86400, а /privacy, /support, /quiz и прочие страницы без
 * revalidate вовсе стали ISR на сутки.
 *
 * И каждая такая перегенерация была записью ISR целиком. Ряд ниже тасуется
 * по дате, а лежал он в RSC каждой страницы, так что вчерашняя и сегодняшняя
 * копии любой страницы различались хотя бы полкой, и пропустить запись
 * одинакового результата Vercel было не из чего. Запись карточки игры — около
 * 224 КБ, тридцать блоков ISR по 8 КБ, и до раза в сутки на каждый адрес,
 * куда заходит краулер.
 *
 * Поэтому граница рисует экран без полки (withShelf={false}): ни кэша данных,
 * ни запроса к базе в ней нет, и сторожит это lib/notfound.test.ts. То же
 * правило — для любого кэша с числовым сроком в границе, layout или template
 * под [lang]: он снова опустит срок всех страниц до своего.
 *
 * А /_not-found (app/global-not-found.tsx) пререндерен на сборке и дальше
 * статичен до следующего деплоя: запрос к базе — один на сборку, и кэшу
 * сберегать нечего. Вредить он стал бы: unstable_cache хранит результат и
 * между деплоями (docs: 04-functions/unstable_cache.md), его ключ держится на
 * тексте функции, а не на сборке, и с revalidate: false новая сборка могла бы
 * взять верх каталога, записанный когда-то давно.
 *
 * Молчащая база или пустая выборка — пустая полка (catch ниже). Сборка на
 * пустой базе (превью со своей свежей базой) так и оставит 404 без полки до
 * следующего деплоя, и это не поломка.
 */
async function shelf() {
  try {
    const games = await topCatalogGames(await getDb(), POOL)
    if (games.length <= SHELF) return games
    /*
     * Ряд — по дате рендера, а не новый на каждый заход: у страницы ошибок
     * должно быть постоянное лицо в пределах одного визита — иначе возврат
     * назад показывает другие игры и читается как ещё один сбой. Тот же
     * приём и тот же генератор, что у «Игры дня». На проде /_not-found
     * рисуется раз на сборку, и ряд держится до следующего деплоя.
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

/**
 * Голова 404 под /en — с английской подписью корневой карточки: та же
 * app/[lang]/opengraph-image.tsx, что у корневого layout на en (rootCardOn в
 * app/[lang]/layout.tsx, docs/i18n.md, п. 10), объявленная ещё раз — уже
 * уровнем not-found.
 *
 * Своей метадаты здесь не было, и подписать 404 корневой layout не мог: на
 * not-found Next ставит файлы корня ещё раз, последним уровнем
 * (errorMetadataItem в resolve-metadata), вместе с метадатой этого файла. Без
 * своих images файловая карточка побеждала, и сырой HTML каждой 404 под /en
 * (/en/xyz, /en/game/<нет такой>) отдавал в og:image:alt и twitter:image:alt
 * «imbored — во что поиграть» рядом с og:locale en_US. Сырой HTML — это то,
 * что читают краулеры и превью мессенджеров: скрипт они не исполняют.
 *
 * openGraph уровня заменяет накопленный целиком, поэтому здесь он корневой
 * весь — тип, имя сайта, язык и карточка, — из generateMetadata корня, а не
 * копией: разойтись им не в чем. twitter:image Next достраивает из openGraph
 * сам, с той же подписью.
 *
 * Русская 404 (/game/<нет такой>) своего openGraph не объявляет: работает
 * файл, как работал, и её голова не меняется ни на байт. Язык — из params
 * (props уровня [lang]), как у метадаты страниц с тестами.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const locale = toLocale((await params).lang)
  if (locale !== 'en') return {}
  const { openGraph } = await rootMetadata({ params: Promise.resolve({ lang: locale }), children: null })
  return { openGraph }
}

/**
 * Язык — из сегмента [lang] (next/root-params): 404 под /en/… рисуется
 * внутри английского layout и обязан говорить по-английски.
 *
 * Без полки: эта граница рисуется вместе с каждой страницей сайта, и кэш
 * данных в ней ставил потолок срока всем страницам (докблок shelf() выше).
 */
export default async function NotFound() {
  return <NotFoundView locale={await getLocale()} withShelf={false} />
}

/**
 * Сам экран 404 — отдельно от границы, потому что рисуют его двое.
 *
 * Граница not-found выше — для notFound() из страниц: /game/<нет такой>,
 * /en/xyz, /en/quiz/xyz. HTML такого ответа в этой версии Next — пустая
 * оболочка (<html id="__next_error__">), а экран дорисовывает клиент:
 * граница not-found — клиентский error boundary, и серверный рендер React
 * его не исполняет (подробно — в app/global-not-found.tsx). Граница зовёт
 * экран с withShelf={false}: поиск и кнопки есть, полки нет.
 *
 * Адрес вне всех разделов (/xyz, /wp-login.php) и опечатку под русским
 * разделом (/quiz/xyz) next.config уводит в /_not-found, и там этот же
 * экран рисует app/global-not-found.tsx —
 * сервером, внутри того же корневого layout, и с полкой: он пререндерен раз
 * на сборку. Язык там не из сегмента (его у /_not-found нет), а русский
 * явно: адрес без префикса — русский сайт.
 */
export async function NotFoundView({ locale, withShelf = true }: { locale: Locale; withShelf?: boolean }) {
  const games = withShelf ? await shelf() : []

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-5 pt-32 pb-16 text-center">
        <div className="flex flex-col items-center gap-4 anim-reveal">
          {/* «404» крупно, как титр: цифра — это и есть новость экрана, а
              знак сайта уже стоит в шапке */}
          <p aria-hidden className="nf-code">404</p>
          <Eyebrow tone="faint" className="sr-only">
            {tr(locale, { ru: 'Ошибка 404', en: 'Error 404' })}
          </Eyebrow>
          <h1 className="font-display text-display-md">{tr(locale, { ru: 'Такой страницы нет', en: 'This page doesn’t exist' })}</h1>
          <p className="max-w-md leading-relaxed text-dim">
            {tr(locale, {
              ru: 'Ссылка битая или игру убрали из каталога. Бывает — зато есть, во что поиграть.',
              en: 'The link is broken or the game left the catalog. It happens — and there’s still plenty to play.',
            })}
          </p>
        </div>

        {/* Шёл за игрой — найди её по названию: переиздание или опечатка в
            адресе обычно находятся с первых букв */}
        <div className="flex w-full justify-center anim-rise">
          <SearchLauncher variant="field" />
        </div>

        <div className="flex flex-wrap justify-center gap-3 anim-rise">
          <Link
            href="/quiz"
            className="btn-ember px-6 py-3"
          >
            {tr(locale, { ru: 'Подобрать игру', en: 'Find a game' })}
          </Link>
          <Link href="/" className="btn-glass">
            <Icon name="home" size={18} />
            {tr(locale, { ru: 'На главную', en: 'Back to home' })}
          </Link>
        </div>

        {games.length > 0 && (
          <section className="w-full anim-rise" style={{ animationDelay: '120ms' }}>
            <Eyebrow className="mb-3">{tr(locale, { ru: 'Из каталога', en: 'From the catalog' })}</Eyebrow>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4">
              {games.map((g) => (
                <Link
                  key={g.appid}
                  href={`/game/${g.appid}`}
                  transitionTypes={['nav-forward']}
                  className="game-card block text-left"
                >
                  <StaticGameCardBody
                    morph
                    appid={g.appid}
                    name={g.name}
                    locale={locale}
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
