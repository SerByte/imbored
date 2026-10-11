import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { createDb, type Db } from '../lib/db'

/**
 * База для офлайн-скриптов: облако, если задан адрес, иначе файл рядом.
 *
 * Жило внутри promote-catalog, пока скрипт был один. Со вторым (доливка
 * описаний) выбор был такой: либо импортировать из чужого скрипта, либо
 * развести две копии чтения окружения, которые разъедутся при первой же
 * смене имени переменной.
 *
 * Имя файла — catalog.db, а не imbored.db: это каталожная база, которую
 * скрипты наполняют, а не рабочая база дев-сервера.
 */
export async function openDb(): Promise<Db> {
  const remote = process.env.TURSO_DATABASE_URL
  if (remote) {
    console.log('база: Turso (облако)')
    return openCloud(remote, process.env.TURSO_AUTH_TOKEN)
  }
  const dir = path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'catalog.db')
  console.log(`база: ${file}`)
  return createDb(`file:${file}`)
}

/**
 * Облако по адресу из TURSO_DATABASE_URL. readOnly — для путей, которые
 * только смотрят: --dry-run и отчёты. Они открывают его БЕЗ миграций.
 *
 * ЗАЧЕМ. createDb прогоняет migrateDb, а у локального процесса нет
 * VERCEL_ENV, и destructiveMigrationsAllowed для него — «можно всё».
 * `npm run catalog:publish -- --dry-run` из ветки, «просто посмотреть, что
 * поедет», доводил прод до схемы этой ветки: колонки, индексы с полным сканом
 * по games, пересборка feedback, починка JSON и отметка версии — до ревью и
 * до бэкапа, который владелец снимает перед деплоем. Ветку бросили или
 * переделали — схема и версия на проде остались, и переделанная миграция
 * уже не выполнится. news-report и forget-user по той же причине обходятся
 * без createDb вовсе.
 *
 * Чтение без миграций опирается на то, что нужные ему таблицы на проде уже
 * есть. Если ветка читает колонку, которой там ещё нет, запрос упадёт на
 * «no such column» — громко и ничего не изменив, а это и есть цена
 * «посмотреть».
 *
 * Пишущие пути мигрируют облако, как и раньше, и это задумано: заливке нужны
 * колонки ветки. Локальный файл (file:) мигрирует и на чтение — своя база,
 * и свежий файл без схемы пуст: отчёт упал бы на «no such table».
 */
export async function openCloud(
  url: string,
  authToken: string | undefined,
  { readOnly = false }: { readOnly?: boolean } = {},
): Promise<Db> {
  if (!readOnly || url.startsWith('file:')) return createDb(url, authToken)
  return createClient({ url, authToken })
}
