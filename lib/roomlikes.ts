import type { RoomVote } from './db'

export type MemberRef = { steamid: string; name: string }

/**
 * «Вы почти совпали» — БЕЗ названия игры. Намеренно, и это не компромисс.
 *
 * Во-первых, спойлер: matchCeremony называет матч самой большой эмоцией
 * продукта и тратит на него отдельную gsap-таймлинию. Подпись «вы с Димой оба
 * за Deep Rock Galactic» сообщает финал заранее каждому, кто уже проголосовал
 * «за», — фича, чей успех обесценивает собственный экран развязки.
 *
 * Во-вторых, приватность: на доске «Пати» в открытую комнату подсаживаются
 * незнакомые люди. При двух участниках «двое за X» — это точное раскрытие
 * чужого голоса тому, кого в комнату никто не звал.
 *
 * Поэтому наружу идёт напряжение без разрешения: «вы с Димой сошлись на двух
 * играх, ждём Сашу». Поля appid в типе нет вовсе — не потому что клиенту не
 * нужно, а чтобы его физически нельзя было вывести на экран. Пинится тестом.
 */
export type NearMiss = {
  /** кто уже «за», в порядке входа в комнату */
  forNames: string[]
  /** кого ждём — они по этой карте ещё не голосовали */
  pendingNames: string[]
  meFor: boolean
  /** ждут меня: «Дима и Саша уже сошлись — ждём тебя» */
  mePending: boolean
  /** сколько игр дают ровно такой расклад — «сошлись на двух играх» */
  games: number
}

export const LIKES_MINE_MAX = 12
export const LIKES_NEAR_MAX = 3

export function buildLikes(args: {
  votes: RoomVote[]
  members: MemberRef[]
  me: string
  maxMine?: number
  maxNear?: number
}): { mineAppids: number[]; near: NearMiss[] } {
  const { votes, members, me } = args
  const maxMine = args.maxMine ?? LIKES_MINE_MAX
  const maxNear = args.maxNear ?? LIKES_NEAR_MAX

  const mineAppids = votes
    .filter((v) => v.steamid === me && v.vote === 1)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, maxMine)
    .map((v) => v.appid)

  // Порядок имён — порядок входа в комнату: members приходит из roomMembers
  // отсортированным по joined_at, и группировка раскладов на него опирается
  const nameOf = new Map(members.map((m) => [m.steamid, m.name]))

  const byApp = new Map<number, Map<string, 0 | 1>>()
  for (const v of votes) {
    if (!nameOf.has(v.steamid)) continue // вышедшие из комнаты не считаются
    let m = byApp.get(v.appid)
    if (!m) {
      m = new Map()
      byApp.set(v.appid, m)
    }
    m.set(v.steamid, v.vote)
  }

  const groups = new Map<string, NearMiss>()
  for (const [, cast] of byApp) {
    const forIds = members.filter((m) => cast.get(m.steamid) === 1)
    const noIds = members.filter((m) => cast.get(m.steamid) === 0)
    const pendingIds = members.filter((m) => !cast.has(m.steamid))

    // «Почти» — это когда договорённость ещё возможна. Один голос «против»
    // делает карту мёртвой навсегда (findRoomMatch требует единогласия), и
    // показывать её как почти-совпадение — то же враньё, что мы убираем.
    // Все «за» — это уже матч, им занимается роут голосования.
    if (forIds.length < 2 || noIds.length > 0 || pendingIds.length === 0) continue

    const forNames = forIds.map((m) => m.name)
    const pendingNames = pendingIds.map((m) => m.name)
    const key = `${forIds.map((m) => m.steamid).join(',')}|${pendingIds
      .map((m) => m.steamid)
      .join(',')}`

    const found = groups.get(key)
    if (found) {
      found.games += 1
      continue
    }
    groups.set(key, {
      forNames,
      pendingNames,
      meFor: forIds.some((m) => m.steamid === me),
      mePending: pendingIds.some((m) => m.steamid === me),
      games: 1,
    })
  }

  const near = [...groups.values()]
    .sort((a, b) => b.forNames.length - a.forNames.length || b.games - a.games)
    .slice(0, maxNear)

  return { mineAppids, near }
}
