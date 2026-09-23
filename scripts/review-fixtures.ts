/**
 * Фикстуры для разбора отзывов: сырые ответы appreviews в lib/__fixtures__/reviews.
 *
 *   npm run reviews:fixtures                      шесть игр по умолчанию
 *   npm run reviews:fixtures -- 367520 413150     свои appid
 *
 * Тесты lib/reviewmine.test.ts гоняют разбор по всем *.json в этой папке, а в
 * CI сети нет — поэтому ответы лежат в репозитории, и кладёт их этот скрипт,
 * запущенный руками. Адрес тот же, что у крона (reviewsUrl в lib/reviews): те
 * же языки, тот же порядок, та же сотня отзывов.
 *
 * Только GET к store.steampowered.com: без ключей, без базы, без модели. Из
 * ответа выбрасываются поля, которые разбор не читает (профиль автора, даты,
 * флаги), — остаются тексты, голоса и минуты. После записи печатается сводка
 * полос: по ней видно, что словари вообще что-то ловят.
 */

import fs from 'node:fs'
import path from 'node:path'
import { STORE_PACE_MS } from '../lib/catalog'
import { pace } from '../lib/pace'
import { LANES, mineReviews, parseReviewsRaw } from '../lib/reviewmine'
import { reviewsUrl, type ReviewsResponse } from '../lib/reviews'

/**
 * По игре на каждую полосу, которую надо уметь отличать: сложная (Hollow
 * Knight), уютная (Stardew Valley), «ещё один ход» и медленный старт
 * (Civilization VI), короткие забеги (Hades), сложная в освоении (Factorio),
 * сюжетная (Disco Elysium). Сравнение Hollow Knight со Stardew — в тестах.
 */
const DEFAULT_APPIDS = [367520, 413150, 289070, 1145360, 427520, 632470]

const DIR = path.join(process.cwd(), 'lib', '__fixtures__', 'reviews')

/** Только поля, которые читают parseReviews и parseReviewsRaw */
function trim(json: ReviewsResponse): ReviewsResponse {
  return {
    success: json.success,
    query_summary: json.query_summary,
    reviews: (json.reviews ?? []).map((r) => ({
      recommendationid: r.recommendationid,
      language: r.language,
      review: r.review,
      voted_up: r.voted_up,
      votes_up: r.votes_up,
      author: {
        playtime_at_review: r.author?.playtime_at_review,
        playtime_forever: r.author?.playtime_forever,
      },
    })),
  }
}

async function main() {
  const fromArgs = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  const appids = fromArgs.length ? fromArgs : DEFAULT_APPIDS
  fs.mkdirSync(DIR, { recursive: true })

  for (const appid of appids) {
    await pace('steam-store', STORE_PACE_MS)
    const res = await fetch(reviewsUrl(appid), { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      console.error(`${appid}: HTTP ${res.status} — пропускаю`)
      continue
    }
    const json = trim((await res.json()) as ReviewsResponse)
    const raw = parseReviewsRaw(json)
    if (!raw) {
      console.error(`${appid}: Steam ответил success=${json.success} — пропускаю`)
      continue
    }
    const file = path.join(DIR, `${appid}.json`)
    fs.writeFileSync(file, JSON.stringify(json, null, 1) + '\n')

    const m = mineReviews(raw)
    const lanes = LANES.filter((lane) => m.lanes[lane].count > 0)
      .map((lane) => `${lane} ${Math.round(m.lanes[lane].share * 100)}%`)
      .join(', ')
    console.log(
      `${appid}: отзывов ${raw.length}, RU/EN ${m.n}; ${lanes || 'полосы молчат'}` +
        (m.timeToFunHours !== null ? `; до веселья ~${m.timeToFunHours} ч (${m.timeToFunMentions})` : ''),
    )
  }
  console.log(`\nфикстуры: ${path.relative(process.cwd(), DIR)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
