/**
 * npm run isr:check — сверить сроки ISR, которые сборка правда записала, с
 * задуманными.
 *
 * Запускается после `next build`, как npm run budget: читает
 * .next/prerender-manifest.json и сама ничего не собирает.
 *
 * Зачем. Срок страницы — не то число, что стоит в её `revalidate`, а меньшее
 * из всего, что попало в её дерево: unstable_cache, fetch или сегмент с
 * числовым revalidate опускают срок всей записи ISR молча
 * (next/dist/server/web/spec-extension/unstable-cache.js). Так полка 404 с
 * unstable_cache на сутки, нарисованная в каждом RSC корневого layout,
 * держала на сутках весь сайт: «недельные» карточки игр, хабы и даже
 * /privacy перегенерировались ежедневно, и Hobby выбрал ISR Writes вдесятеро
 * (докблок app/[lang]/not-found.tsx). Сторожа исходников (lib/prodinfra.test.ts)
 * видят три файла, этот — итог сборки, откуда бы ни пришёл потолок.
 *
 * Страницы без своего revalidate должны выйти статическими (false), прочие —
 * ровно со своим сроком. Карточки игр и патчей вне прода не пререндерятся, и
 * их сроков в манифесте нет; их держат тесты страниц и общий потолок здесь:
 * упади он на статических — упал бы и на них.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(__dirname, '..')
const MANIFEST = '.next/prerender-manifest.json'
if (!fs.existsSync(path.join(ROOT, MANIFEST))) {
  console.error(`Нет ${MANIFEST}: сначала npm run build.`)
  process.exit(1)
}

type Route = { initialRevalidateSeconds?: number | false }
const routes = (JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST), 'utf8')) as { routes: Record<string, Route> }).routes

const DAY = 86_400
const WEEK = 7 * DAY
const both = (p: string): string[] => [`/ru${p}`, `/en${p}`]

/** Адрес → срок, который у него обязан быть. false — статическая до деплоя. */
const EXPECTED: Array<[string, number | false]> = [
  // своих revalidate у них нет: всё, что не false, — потолок из дерева
  ...['/privacy', '/support', '/quiz', '/daily', '/explore', '/play', '/missing', '/rooms', '/room/new']
    .flatMap(both)
    .map((p): [string, false] => [p, false]),
  ['/_not-found', false],
  // свои сроки
  ['/ru', DAY],
  ['/en', DAY],
  ...both('/games').map((p): [string, number] => [p, WEEK]),
  ...both('/whatsnew/feed.xml').map((p): [string, number] => [p, DAY]),
  ['/sitemap.xml', WEEK],
  ['/search-index.json', DAY],
]

const show = (v: number | false | undefined) => (v === false ? 'false' : v === undefined ? 'нет' : `${v} с`)
const problems: string[] = []
for (const [route, want] of EXPECTED) {
  const got = routes[route]?.initialRevalidateSeconds
  const mark = got === want ? ' ' : '✗'
  console.log(`${mark} ${route.padEnd(28)} ${show(got).padStart(10)}  нужно ${show(want)}`)
  if (!(route in routes)) problems.push(`${route}: нет в манифесте — маршрут перестал пререндериться или переехал; поправь EXPECTED`)
  else if (got !== want)
    problems.push(
      `${route}: ${show(got)} вместо ${show(want)}. Меньше задуманного — значит, в дереве страницы (layout, not-found, template или то, что они рисуют) появился кэш с числовым revalidate`,
    )
}
if (problems.length) {
  console.error('\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`\nСроки ISR: ${EXPECTED.length} адресов, все как задумано.`)
