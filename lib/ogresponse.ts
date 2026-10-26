import { ImageResponse } from 'next/og'

/**
 * ImageResponse для картинки, которая живёт в ISR, — без своего Cache-Control.
 *
 * Карточки в динамических сегментах (жанр, выбор, комната, портрет,
 * совместимость; у игры и патча они тоже были, пока их не сменила шапка Steam
 * — shareArt в lib/art) объявляют revalidate и регистрируют сегмент пустым
 * generateStaticParams: замысел — нарисовать картинку один раз и отдавать из
 * кэша неделю, сутки или час. На проде этого не было НИ РАЗУ. После первого
 * MISS каждый следующий заход отвечал X-Vercel-Cache: STALE — отдавалась
 * прошлая копия и тут же запускалась перерисовка: /game/730 — MISS, STALE на
 * 73-й секунде, STALE на 14-й; /game/570 — STALE на 493-й и через шесть
 * секунд снова STALE на пятой, то есть свежая перерисовка устаревала
 * мгновенно. Карточка, рассчитанная на одну отрисовку в неделю, стоила
 * отрисовку на каждый заход краулера превью: чтение Turso, до трёх походов
 * за артом (у жанра — двенадцать постеров), satori с resvg на 0,5–2,2 с и
 * PNG до мегабайта.
 *
 * Механика — в установленном Next 16.3, по исходникам:
 *   • next/og ставит каждому ответу `public, max-age=0, must-revalidate`
 *     (next/dist/server/og/image-response.js) — для запроса без кэша это
 *     честно, а revalidate маршрута он не знает;
 *   • app-route пишет s-maxage из revalidate, только если у ответа обработчика
 *     НЕТ своего Cache-Control (next/dist/build/templates/app-route.js:
 *     «If cache control is already set on the response we don't override it»);
 *   • запись ISR, созданная по требованию, на Vercel живёт столько, сколько
 *     сказал этот заголовок, — то есть ноль секунд.
 * Пререндеренная на сборке корневая /opengraph-image при этом отвечала HIT:
 * её срок задаёт манифест сборки, а не заголовок ответа. Поэтому поломку и не
 * было видно, пока не померили карточки динамических сегментов.
 *
 * Помощник снимает заголовок next/og, и срок ставит сам Next — `s-maxage=<
 * revalidate>, stale-while-revalidate=…` из export const revalidate маршрута.
 * Своё число здесь не пишется намеренно: второй источник срока разъехался бы
 * с revalidate при первой же правке, как разъезжался у страницы игры с её
 * прежней карточкой.
 *
 * Браузер и после правки видит `public, max-age=0, must-revalidate`: s-maxage
 * Vercel оставляет себе. Проверять — по X-Vercel-Cache: второй curl той же
 * карточки через несколько секунд должен дать HIT с растущим Age.
 *
 * Только для маршрутов с revalidate. Статические картинки (корневая карточка,
 * иконки) не трогаются: у них срок из сборки, и они уже HIT. Сторож, что ни
 * одна картинка с revalidate не рисуется голым new ImageResponse, —
 * lib/social.test.ts.
 */
export function isrImage(...args: ConstructorParameters<typeof ImageResponse>): ImageResponse {
  const res = new ImageResponse(...args)
  res.headers.delete('cache-control')
  return res
}
