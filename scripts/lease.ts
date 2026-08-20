import { randomUUID } from 'node:crypto'
import { acquireLease, releaseLease, type Db } from '../lib/db'

/** Сколько держим за раз. Продлевать обязан вызывающий — каждым кругом. */
const TTL_SEC = 300

/**
 * Аренда вокруг ручного прогона.
 *
 * Зачем она скрипту вообще. Очереди у нас разбираются НЕ резервированием:
 * claimPageEnrichBatch и getUnsummarized только читают, ничего не помечая.
 * Значит, ручной прогон и крон, взявшись за дело одновременно, спокойно
 * возьмут одни и те же записи и заплатят за них дважды — двумя запросами в
 * Steam на карточку и вызовом модели сверху. Аренда это единственное, что
 * разводит их по времени.
 *
 * Лимиты Steam тут ни при чём: они считаются по IP, а прогон идёт с машины
 * оператора, не с Vercel. Разводим не темп запросов, а двойную работу.
 *
 * Ключей может быть несколько: опрос новостей ходит и в Steam, и к модели, то
 * есть перебегает дорогу сразу двум кронам. Берём по порядку, и если второй
 * занят — первый отдаём, а не держим в ожидании неизвестно чего.
 *
 * Ctrl+C не выполняет finally: процесс просто умирает, и аренда висит до
 * истечения TTL — то есть собственный перезапуск упирается в свой же замок на
 * пять минут. Для ручного инструмента это недопустимо, поэтому сигналы
 * перехватываем и отдаём аренду руками. От SIGKILL и падения рантайма это не
 * спасает — на такой случай и стоит TTL.
 */
export async function withLease<T>(
  db: Db,
  keys: string | string[],
  opts: { busyNote: string },
  body: (h: { renew: () => Promise<void> }) => Promise<T>,
): Promise<T | null> {
  const список = typeof keys === 'string' ? [keys] : keys
  const holder = `local:${randomUUID()}`
  const взято: string[] = []

  const отдать = async () => {
    // По одному: провал на одном ключе не должен оставить второй висеть.
    for (const k of взято.splice(0)) await releaseLease(db, k, holder).catch(() => {})
  }

  for (const k of список) {
    if (await acquireLease(db, k, holder, TTL_SEC, Math.floor(Date.now() / 1000))) {
      взято.push(k)
      continue
    }
    await отдать()
    console.log(
      `${opts.busyNote}\nОна истекает сама, ждать не больше ${TTL_SEC} с.`,
    )
    return null
  }

  const onSignal = () => {
    void отдать().finally(() => {
      console.log('\nаренда отдана, выходим')
      process.exit(130)
    })
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    return await body({
      renew: async () => {
        const now = Math.floor(Date.now() / 1000)
        // Реентерабельна по holder — повторный acquire это и есть продление
        for (const k of взято) await acquireLease(db, k, holder, TTL_SEC, now)
      },
    })
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await отдать()
  }
}
