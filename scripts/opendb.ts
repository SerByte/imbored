import fs from 'node:fs'
import path from 'node:path'
import { createDb, type Db } from '../lib/db'

/**
 * База для офлайн-скриптов: облако, если задан адрес, иначе файл рядом.
 *
 * Жило внутри promote-catalog, пока скрипт был один. Со вторым (доливка
 * описаний) выбор был тот же, что у withoutBody и SCORE_RU в этот же день:
 * либо импортировать из чужого скрипта, либо развести две копии чтения
 * окружения, которые разъедутся при первой же смене имени переменной.
 *
 * Имя файла — catalog.db, а не imbored.db: это каталожная база, которую
 * скрипты наполняют, а не рабочая база дев-сервера.
 */
export async function openDb(): Promise<Db> {
  const remote = process.env.TURSO_DATABASE_URL
  if (remote) {
    console.log('база: Turso (облако)')
    return createDb(remote, process.env.TURSO_AUTH_TOKEN)
  }
  const dir = path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'catalog.db')
  console.log(`база: ${file}`)
  return createDb(`file:${file}`)
}
