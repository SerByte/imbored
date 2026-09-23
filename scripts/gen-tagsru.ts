/**
 * Русские подписи тегов для интерфейса — генерирует lib/tagsru.steam.ts.
 *
 *   npm run tags:ru                              словари из Steam: два GET, без ключа
 *   npm run tags:ru -- --db=data/catalog.db      из локального каталога (tags.name_ru)
 *   npm run tags:ru -- --dry-run                 показать, сколько пар, и не писать
 *
 * Зачем статический файл, а не чтение tags.name_ru на каждом ответе. Подпись
 * нужна везде, где рисуется тег: чипсы выдачи и колоды пати, карточка игры,
 * причина эвристики. Это клиентские компоненты и страницы на ISR, и каждой из
 * них пришлось бы тащить словарь из базы — ради четырёх сотен строк, которые
 * меняются, когда Steam заводит новый тег, то есть раз в месяцы.
 *
 * Ключи — английские, ровно как в tags_json: по ним идут все сравнения
 * подбора (VIBE_TAGS, TIME_TAGS, профиль вкуса), и перевод их не трогает.
 * Кривой перевод Steam («Character Action Game» → «Яркий главный герой»)
 * правится в lib/tagsru.overrides.ts — этот скрипт тот файл не трогает.
 *
 * Базу скрипт только читает и к облаку не подключается: --db — путь к файлу.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { fetchTagDictionary } from '../lib/catalog'
import {
  joinTagDictionaries,
  MIN_PAIRS,
  normalizePairs,
  renderTagsRuModule,
  type TagPair,
} from './tagsrugen'

const OUT = path.join(process.cwd(), 'lib', 'tagsru.steam.ts')

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function fromSteam(): Promise<TagPair[]> {
  const [en, ru] = await Promise.all([
    fetchTagDictionary(fetch, 'english'),
    fetchTagDictionary(fetch, 'russian'),
  ])
  console.log(`Steam: английских ${en.size}, русских ${ru.size}`)
  return joinTagDictionaries(en, ru)
}

async function fromDb(file: string): Promise<TagPair[]> {
  if (!fs.existsSync(file)) throw new Error(`нет файла базы: ${file}`)
  const db = createClient({ url: `file:${file}` })
  try {
    const res = await db.execute(
      "SELECT name, name_ru FROM tags WHERE name_ru IS NOT NULL AND name_ru != ''",
    )
    return res.rows.map((r) => [String(r.name), String(r.name_ru)] as const)
  } finally {
    db.close()
  }
}

async function main() {
  const dbFile = arg('db')
  const source = dbFile ? `tags.name_ru в ${path.basename(dbFile)}` : 'populartags Steam'
  const pairs = normalizePairs(dbFile ? await fromDb(path.resolve(dbFile)) : await fromSteam())

  if (pairs.length < MIN_PAIRS) {
    throw new Error(
      `пар всего ${pairs.length} (нужно хотя бы ${MIN_PAIRS}) — похоже на сбой источника; ` +
        `${path.relative(process.cwd(), OUT)} не тронут`,
    )
  }
  console.log(`пар: ${pairs.length}`)
  if (process.argv.includes('--dry-run')) {
    console.log('--dry-run: ничего не записано')
    return
  }
  fs.writeFileSync(OUT, renderTagsRuModule(pairs, source))
  console.log(`записано: ${path.relative(process.cwd(), OUT)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
