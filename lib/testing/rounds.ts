import type { InStatement } from '@libsql/client'
import type { Db } from '../db'

/**
 * Глубина лесенки запросов: сколько обращений к базе стоят друг за другом.
 *
 * На Turso каждое обращение — сетевой круг, около тридцати пяти миллисекунд
 * по замеру на проде (lib/candidates.ts), и страница ждёт не ЧИСЛА запросов, а
 * длины самой длинной цепочки из них: пять запросов одним Promise.all стоят
 * одного круга, три подряд — трёх. Счётчик вызовов execute этой разницы не
 * видит, поэтому тесты задержки меряют глубину.
 *
 * Каждый запрос получает номер круга — на единицу больше самого глубокого из
 * тех, что УЖЕ вернулись к его старту. База в памяти отвечает в той же очереди
 * микрозадач, и параллельные запросы выглядели бы последовательными, поэтому
 * ответ откладывается на макрозадачу: запросы одного Promise.all успевают
 * стартовать раньше, чем вернётся любой из них, и делят круг, а запрос,
 * ждавший чужого ответа, встаёт кругом ниже.
 *
 * С поддельными таймерами vitest не работает: отложенный ответ не придёт.
 *
 * Модуль только для тестов: продукт его не импортирует.
 */
export function roundsOf(db: Db): {
  db: Db
  /** Глубина самой длинной цепочки на этот момент; 0 — запросов не было */
  depth: () => number
  /** Каждый запрос со своим кругом — для сообщения упавшей проверки */
  log: Array<{ round: number; sql: string }>
} {
  let finished = 0
  const log: Array<{ round: number; sql: string }> = []
  const spy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'execute') return Reflect.get(target, prop, receiver)
      return async (q: InStatement) => {
        const round = finished + 1
        log.push({ round, sql: (typeof q === 'string' ? q : q.sql).replace(/\s+/g, ' ').slice(0, 120) })
        await new Promise((r) => setTimeout(r, 0))
        try {
          return await target.execute(q)
        } finally {
          finished = Math.max(finished, round)
        }
      }
    },
  })
  return { db: spy, depth: () => log.reduce((d, e) => Math.max(d, e.round), 0), log }
}
