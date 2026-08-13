/**
 * Один срез работы по патчноутам: опросить порцию игр, записать новое,
 * пересказать непересказанное.
 *
 * Логика живёт здесь, а не в роуте крона, по двум причинам: vitest собирает
 * только lib/**\/*.test.ts, и ровно этот же срез гоняет ручной скрипт
 * scripts/sync-news.ts — расписание и разовый прогон обязаны делать одно и то же.
 *
 * Пропускная способность (Hobby, гэп хоста 1700 мс):
 *   ёмкость/сутки = MAX_CHAIN × SLICE_LIMIT
 *   спрос/сутки   = Σ 86400 / interval(tier, last_pub_at)
 * Держим спрос ниже ёмкости — иначе очередь растёт и хвост не опрашивается.
 */

import {
  claimNewsPollBatch,
  flushPollResults,
  getGameRanks,
  getGamesMeta,
  getUnsummarized,
  pruneNewsForApp,
  setNewsDigest,
  upsertNewsItems,
  type Db,
  type PollOutcome,
  type PollStatus,
  type StoredNews,
} from './db'
import { claudeNewsDigest } from './llm'
import { bodyHash, detectLang, fetchGameNews, isPatchNote, looksTrivial, newsText } from './news'
import { blocksToText } from './steamhtml'

const HOUR = 3600
const DAY = 86_400

/** Сколько постов держим на игру. Строго больше окна разбора (25 в lib/news),
 *  иначе получится вечный цикл «выкинули — перекачали — снова выкинули». */
export const NEWS_KEEP = 30

/** Три неудачи подряд — и игру больше не трогаем */
const MAX_FAILS = 3

/** Игра активно патчится, если постила за последние две недели */
const HOT_WINDOW = 14 * DAY

export type SliceResult = {
  polled: number
  inserted: number
  digested: number
  hasMore: boolean
  stopped: 'done' | 'budget' | 'blocked'
}

/** Когда возвращаться к игре. Каденция от того, как часто она реально патчится,
 *  а не от пожизненного числа отзывов. */
export function nextPollAt(
  args: { tier: number; status: PollStatus; failCount: number; lastPubAt?: number },
  nowSec: number,
): number {
  const { tier, status, failCount, lastPubAt } = args
  if (status === 'error') return nowSec + Math.min(1800 * 2 ** failCount, DAY)
  if (status === 'empty' || status === 'mismatch') return nowSec + 7 * DAY

  const hot = lastPubAt != null && nowSec - lastPubAt < HOT_WINDOW
  if (hot) return nowSec + 24 * HOUR
  if (tier === 0) return nowSec + 72 * HOUR
  const stale = lastPubAt != null && nowSec - lastPubAt > 180 * DAY
  return nowSec + (stale ? 28 : 7) * DAY
}

/**
 * Опрос + пересказ. Дедлайны у фаз РАЗНЫЕ: при общем бюджете фаза опроса
 * всегда съедала бы его целиком и пересказ не выполнялся бы никогда.
 */
export async function runNewsSlice(
  db: Db,
  opts: {
    deadlineAt: number
    nowSec?: number
    limit?: number
    digestLimit?: number
    /** подменяется в тестах: иначе прогон уходит и в сеть, и в лимитер темпа */
    fetchNews?: typeof fetchGameNews
    digestFn?: typeof claudeNewsDigest
    onProgress?: (line: string) => void
  },
): Promise<SliceResult> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  const limit = opts.limit ?? 20
  const digestLimit = opts.digestLimit ?? 12
  const digest = opts.digestFn ?? claudeNewsDigest
  const fetchNews = opts.fetchNews ?? fetchGameNews
  const log = opts.onProgress ?? (() => {})

  // на пересказ оставляем последнюю треть бюджета
  const total = Math.max(0, opts.deadlineAt - Date.now())
  const pollDeadline = Date.now() + Math.floor(total * 0.65)

  const targets = await claimNewsPollBatch(db, now, limit)
  const ranks = await getGameRanks(
    db,
    targets.map((t) => t.appid),
  )

  const outcomes: PollOutcome[] = []
  let inserted = 0
  let polled = 0
  let blockedRun = 0
  let stopped: SliceResult['stopped'] = 'done'

  for (const t of targets) {
    if (Date.now() > pollDeadline) {
      stopped = 'budget'
      break
    }
    polled++
    const items = await fetchNews(t.appid, fetch, now)

    if (items === null) {
      // Подряд идущие отказы на РАЗНЫХ играх означают, что Steam закрылся от
      // нашего IP (он это делает — см. lib/gamepage.ts:43). Штамповать в этот
      // момент весь набор как «мёртвый» нельзя: аренда истечёт сама.
      blockedRun++
      const failCount = t.failCount + 1
      const status: PollStatus = failCount >= MAX_FAILS ? 'gone' : 'error'
      outcomes.push({
        appid: t.appid,
        status,
        failCount,
        nextAt: nextPollAt({ ...t, status: 'error', failCount }, now),
        ...(t.lastPubAt ? { lastPubAt: t.lastPubAt } : {}),
      })
      if (blockedRun >= 3) {
        stopped = 'blocked'
        break
      }
      continue
    }
    blockedRun = 0

    if (!items.length) {
      outcomes.push({
        appid: t.appid,
        status: 'empty',
        failCount: 0,
        nextAt: nextPollAt({ ...t, status: 'empty', failCount: 0 }, now),
      })
      continue
    }

    const rank = ranks.get(t.appid) ?? 0
    const rows: StoredNews[] = items.map((it) => {
      const text = newsText(it)
      const patch = isPatchNote(it.title, text)
      return {
        appid: it.appid,
        gid: it.gid,
        title: it.title,
        url: it.url,
        publishedAt: it.publishedAt,
        kind: patch ? 'patch' : 'news',
        // Масштаб проставляем СРАЗУ эвристикой, а Claude потом уточняет.
        // Наоборот (оставить null до модели) нельзя: без ANTHROPIC_API_KEY
        // масштаб не проставился бы никогда, и лента крупных обновлений
        // осталась бы навсегда пустой.
        scale: patch ? (looksTrivial(it.title, text) ? 'hotfix' : 'major') : null,
        blocks: it.blocks,
        bodyHash: bodyHash(it.blocks),
        ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
        rank,
      }
    })

    const n = await upsertNewsItems(db, rows, now)
    inserted += n
    if (n > 0) await pruneNewsForApp(db, t.appid, NEWS_KEEP)

    const lastPubAt = Math.max(...items.map((i) => i.publishedAt))
    outcomes.push({
      appid: t.appid,
      status: 'ok',
      failCount: 0,
      nextAt: nextPollAt({ ...t, status: 'ok', failCount: 0, lastPubAt }, now),
      lastPubAt,
    })
    if (n > 0) log(`  ${t.appid}: +${n}`)
  }

  await flushPollResults(db, outcomes, now)

  // ---- фаза пересказа, свой бюджет ----
  let digested = 0
  const pending = await getUnsummarized(db, digestLimit)
  if (pending.length) {
    const metas = await getGamesMeta(
      db,
      pending.map((p) => p.appid),
    )
    for (const item of pending) {
      if (Date.now() > opts.deadlineAt) break
      const text = blocksToText(item.blocks)
      const res = await digest({
        gameName: metas.get(item.appid)?.name ?? `Игра ${item.appid}`,
        title: item.title,
        body: text,
        lang: detectLang(text),
      })
      await setNewsDigest(db, item.appid, item.gid, res, now)
      if (res) digested++
    }
  }

  return {
    polled,
    inserted,
    digested,
    hasMore: targets.length === limit && stopped !== 'blocked',
    stopped,
  }
}
