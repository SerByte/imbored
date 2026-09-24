/*
 * ДЕЙСТВИЯ И ПРИЧИНЫ ФИДБЕКА — ОДИН СПИСОК НА ВЕСЬ ПРОЕКТ.
 *
 * Список действий жил в шести копиях: тип в lib/db.ts, CHECK в SCHEMA, второй
 * CHECK в пересборке таблицы, белый список роута, объединение типов в
 * sendFeedback на /play и литерал 'launched' в условии пересборки. Причины —
 * ещё в трёх. Следующее действие добавили бы в тип, SCHEMA и роут, а строку
 * пересборки забыли: на :memory: тесты зелёные (таблица свежая, из SCHEMA), а
 * на проде INSERT падает с «CHECK constraint failed», /api/feedback отвечает
 * пятисоткой, и клиент, который шлёт фидбек «отправил и забыл», потерю не
 * покажет никому.
 *
 * Теперь типы выводятся отсюда, CREATE таблицы строит feedbackTableSql — и для
 * SCHEMA, и для пересборки, — а пересборка узнаёт старую таблицу по ЛЮБОМУ
 * действию, которого нет в её CHECK, а не по последнему добавленному.
 * Сторож в lib/feedbackkinds.test.ts не даёт завести копию снова.
 *
 * Модуль без импортов: его читают клиентские страницы.
 */

/**
 * Что человек сделал с карточкой.
 *
 * 'launched' — нажал «Запустить». Раньше это писалось как 'liked', и точность
 * подбора на /library росла от любого клика: запуск — ещё не «зашло», а
 * человек, запустивший игру и тут же закрывший её, выглядел довольным.
 *
 * Новое действие — строка в хвост. CHECK на живой базе не меняется на месте:
 * migrateDb пересоберёт таблицу сама (см. feedbackCheckStale), но только под
 * подъёмом CURRENT_SCHEMA_V в lib/db.ts, иначе база с записанной версией
 * пересборку не увидит.
 */
export const FEEDBACK_ACTIONS = ['liked', 'skipped', 'opened', 'banned', 'launched'] as const

export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number]

/**
 * Почему — у скипа, бана и свайпа колоды.
 *
 * 'spin' — «Крутить ещё» в рулетке: не оценка игры, а бросок кубика. Ни вкуса,
 * ни точности подбора не трогает. 'done' — «Уже прошёл» рядом с баном: бан, но
 * по другой причине, чем «не нравится». 'explore' — свайп в колоде
 * исследователя (/explore): «Интересно» пишется как 'opened', «Мимо» — как
 * 'skipped', оба с этой причиной. Листание без обязательств — не промах
 * подбора и не пауза (см. listFeedback, feedbackStats, listExplore).
 *
 * У reason в таблице нет CHECK, поэтому новые значения не требуют миграции.
 * Подписи к ним — на страницах: здесь ключи, а слова у каждого экрана свои.
 */
export const SKIP_REASON_KEYS = ['genre', 'hard', 'tired', 'notnow', 'spin', 'done', 'explore'] as const

export type SkipReason = (typeof SKIP_REASON_KEYS)[number]

export function isFeedbackAction(x: unknown): x is FeedbackAction {
  return (FEEDBACK_ACTIONS as readonly unknown[]).includes(x)
}

export function isSkipReason(x: unknown): x is SkipReason {
  return (SKIP_REASON_KEYS as readonly unknown[]).includes(x)
}

/**
 * Колонки feedback в порядке CREATE — и определение, и копия при пересборке
 * берутся отсюда. Колонка, добавленная в CREATE и забытая в копии, терялась бы
 * на первой же пересборке, а тесты на свежей базе этого бы не заметили.
 *
 * Новая колонка — в хвост, и ещё строкой в ADDED_COLUMNS (lib/db.ts): живая
 * база получает её ALTER'ом, CREATE доходит только до свежих.
 */
const FEEDBACK_COLUMN_DEFS: ReadonlyArray<readonly [string, string]> = [
  ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
  ['steamid', 'TEXT NOT NULL'],
  ['appid', 'INTEGER NOT NULL'],
  ['action', `TEXT NOT NULL CHECK (action IN (${FEEDBACK_ACTIONS.map((a) => `'${a}'`).join(',')}))`],
  ['reason', 'TEXT'],
  ['mood_json', 'TEXT'],
  ['created_at', 'INTEGER NOT NULL'],
]

export const FEEDBACK_COLUMNS: readonly string[] = FEEDBACK_COLUMN_DEFS.map(([name]) => name)

/**
 * CREATE TABLE для feedback — одна форма и для SCHEMA, и для пересборки.
 *
 * ifNotExists — для SCHEMA: там блок выполняется на каждом старте. Пересборке
 * он не нужен и вреден: хвост прерванной попытки она сносит сама.
 */
export function feedbackTableSql(name: string, opts: { ifNotExists?: boolean } = {}): string {
  const cols = FEEDBACK_COLUMN_DEFS.map(([col, def]) => `  ${col} ${def}`).join(',\n')
  return `CREATE TABLE ${opts.ifNotExists ? 'IF NOT EXISTS ' : ''}${name} (\n${cols}\n)`
}

/**
 * Нужна ли таблице пересборка: CHECK есть, а какого-то из действий в нём нет.
 *
 * Проверяется каждое действие, а не последнее добавленное: совсем старая схема
 * без 'banned' и схема без нового хвоста — один и тот же случай, и условие по
 * одному литералу однажды пропустило бы второй. Таблица без CHECK вовсе
 * (ручная правка) пускает любые значения — пересобирать её незачем.
 */
export function feedbackCheckStale(createSql: string | undefined): boolean {
  if (!createSql?.includes('CHECK')) return false
  return FEEDBACK_ACTIONS.some((a) => !createSql.includes(`'${a}'`))
}
