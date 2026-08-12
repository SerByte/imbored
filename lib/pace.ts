/**
 * Сериализованный ограничитель темпа per-хост: параллельные вызовы
 * выстраиваются в очередь (promise-цепочка), а не спят одновременно.
 */
type Entry = { chain: Promise<void>; lastAt: number }

const entries = new Map<string, Entry>()

export function pace(key: string, minGapMs: number): Promise<void> {
  let entry = entries.get(key)
  if (!entry) {
    entry = { chain: Promise.resolve(), lastAt: 0 }
    entries.set(key, entry)
  }
  const current = entry
  const turn = current.chain.then(async () => {
    const wait = current.lastAt + minGapMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    current.lastAt = Date.now()
  })
  current.chain = turn.catch(() => {})
  return turn
}
