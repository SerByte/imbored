import { artCandidates, type GameArtUrls } from './art'

/**
 * Стена постеров экрана ожидания и такт «из многих — одна» — сколько они
 * качают и когда перестают.
 *
 * Замер на проде, /play в демо на телефоне (1.6 Мбит/с, 150 мс): стена
 * держалась на экране около 1.6 с, а все её 24 постера (≈1.45 МБ) доезжали
 * через 4–7 с ПОСЛЕ того, как стены не стало: <img>, вынутый из DOM,
 * докачивает своё. Постер выбранной игры брал library_600x900_2x — не тот
 * файл, что на стене, — и церемония 1.3 с шла на пустой рамке, а арт героя
 * выдачи ждал своей очереди за всем этим до 18–21 с.
 *
 * Модуль без React: решения здесь — чистые функции и тонкая обвязка над
 * Image, их проверяет lib/warmupwall.test.ts.
 */

/**
 * Узкий экран — телефон в портрете. Стена там показывает по четыре-пять
 * постеров в ряду, а качает все двадцать четыре.
 */
export const NARROW_WALL_MEDIA = '(max-width: 480px)'

/**
 * Сколько постеров в стене. Стена — три ряда, каждый повторён дважды, и
 * сдвиг на −50% возвращает его в ту же картинку; петля бесшовна, пока
 * половина ряда шире видимой части сетки (сетка — 160% ширины экрана,
 * повёрнутая на −8°).
 *
 * Широкий экран: от WALL_MIN до всех пришедших (не больше WALL_MAX в
 * lib/warmup) — восемь в ряду закрывают десктоп.
 *
 * Узкий: не больше WALL_NARROW разных. Пять постеров в ряду (кегль высоты
 * 24vh, пропорция 2:3, зазор 12 px) — это 575–790 px на половину ряда при
 * видимых 470–620 px у телефонов шириной 360–480: петля по-прежнему без
 * дыры, а девять постеров (около полумегабайта) не качаются ради места за
 * краем стекла.
 *
 * Маленькая библиотека (меньше WALL_NARROW на телефоне, меньше WALL_MIN на
 * широком) добирается повтором до WALL_MIN и дальше — повтор ничего не
 * стоит, адрес у него тот же. Не до WALL_NARROW: на пятнадцати шов петли
 * ставил вплотную две одинаковые обложки у библиотек из 2, 4, 6 и 12 игр,
 * и длину повтора выбирает он (seamRepeats).
 */
export const WALL_MIN = 18
export const WALL_NARROW = 15

export function wallPool(ids: readonly number[], narrow: boolean): number[] {
  if (ids.length === 0) return []
  if (narrow && ids.length >= WALL_NARROW) return ids.slice(0, WALL_NARROW)
  if (ids.length >= WALL_MIN) return [...ids]
  const repeat = (size: number) => Array.from({ length: size }, (_, i) => ids[i % ids.length])
  for (const size of [WALL_MIN, WALL_MIN + 3, WALL_MIN + 6]) {
    const pool = repeat(size)
    if (!seamRepeats(pool)) return pool
  }
  // Один или три постера на всю стену — ряд и так из одной картинки
  return repeat(WALL_MIN)
}

/**
 * Ряды стены — каждый третий постер пула. Тем же делением рисует
 * PosterWall (components/WarmupScreen), и по нему же wallPool проверяет шов.
 */
export function wallRows(pool: readonly number[]): number[][] {
  return [0, 1, 2].map((r) => pool.filter((_, i) => i % 3 === r))
}

/**
 * Встанет ли постер вплотную к самому себе на шве петли.
 *
 * Ряд рисуется дважды подряд, [...row, ...row], и последний постер ряда
 * стоит рядом с первым. Пул из k постеров, повторённый по кругу до длины
 * size, кладёт их рядом, когда k делит 3·(size/3 − 1): так при k = 2, 4,
 * 6 и 12 выходило на пятнадцати, а при k = 5 и 15 — на восемнадцати, и
 * две одинаковые обложки плыли через экран парой. Из 18, 21 и 24 для
 * любого k, кроме 1 и 3, годится хотя бы одна длина: 15, 18 и 21 вместе
 * делит только тройка.
 */
function seamRepeats(pool: readonly number[]): boolean {
  return wallRows(pool).some((row) => row.length > 1 && row[0] === row[row.length - 1])
}

/**
 * Обрывает загрузки постеров, которые ещё не доехали.
 *
 * Картинка, вынутая из DOM, докачивает своё; оборвать запрос можно, только
 * сняв с неё адрес. Уже загруженные не трогаем — снимать нечего, а на экране
 * (если стена ещё видна) они бы пропали. Пустая плитка под стеной тусклая и
 * без того: в такте выбора стена гаснет (.warmup.is-chosen).
 */
export function stopWallLoads(root: ParentNode): number {
  let stopped = 0
  for (const img of root.querySelectorAll('img')) {
    if (img.complete) continue
    img.removeAttribute('src')
    stopped++
  }
  return stopped
}

/**
 * Постер такта «из многих — одна» — один файл, без srcSet.
 *
 * Первый кандидат постера: library_capsule из базы или плоский
 * library_600x900 — тот самый адрес, что у плитки стены (legacyArtUrl), пока
 * в базе нет своего. У своей игры со стены он, как правило, уже в кэше. С
 * srcSet (как было через GameArt, sizes="280px") телефон с DPR больше 1.07
 * брал library_600x900_2x — второй файл в четыре раза тяжелее, мимо кэша.
 */
export function chosenPoster(game: { appid: number; art?: GameArtUrls | null }): string | undefined {
  return game.appid > 0 ? artCandidates({ appid: game.appid, art: game.art }, 'poster')[0] : undefined
}

/** Сколько такт выбора ждёт свой постер, прежде чем от такта отказаться. */
export const CHOSEN_POSTER_WAIT_MS = 400

/**
 * Успеет ли постер к такту выбора: true — картинка загружена и
 * раскодирована, false — не успела за ms или не загрузилась вовсе.
 *
 * Такт держит экран ожидания 1.6 с ради постера — без постера это пауза
 * перед выдачей, у которой ничего не происходит. Поэтому на медленной сети
 * его лучше пропустить: герой выдачи встаёт сразу, а «из многих — одна»
 * остаётся тем, у кого постер уже в кэше со стены.
 *
 * Не успел — загрузка обрывается: постер больше не нужен, а канал нужен
 * арту героя. Высокий приоритет — потому что на том же хосте ещё могут
 * качаться постеры стены.
 */
export function posterReady(url: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!ok) img.removeAttribute('src')
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), ms)
    img.fetchPriority = 'high'
    img.decoding = 'async'
    img.src = url
    img.decode().then(
      () => finish(true),
      () => finish(false),
    )
  })
}
