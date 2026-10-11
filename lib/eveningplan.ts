/*
 * «ПЛАН НА ВЕЧЕР» — ИГРА, ОТЛОЖЕННАЯ НА ПОТОМ, ВОЗВРАЩАЕТСЯ ОДНОЙ СТРОКОЙ.
 *
 * Два нажатия говорят «сыграю, но не сейчас». «Поставь на загрузку заранее»
 * под героем /play и /daily (steam://install, intent 'install') — на
 * компьютере. И «Сыграю вечером на ПК» там же на телефоне (intent
 * 'tonight'): steam:// на телефоне не работает, и решение, принятое в
 * автобусе, упиралось в строку-подсказку «это делается в приложении Steam».
 * Оба пишутся строкой 'opened' со снимком intent — планом, а не оценкой:
 * вкус и паузы их не видят (listFeedback в lib/db.ts).
 *
 * Раньше план никто не читал обратно: поставил на загрузку — и сервис об
 * этом забыл. Теперь самый свежий живой план (latestEveningPlan) приходит
 * сам: строкой на главной (lib/liveline) и строкой «Запустить» над
 * «Продолжить» на /play. Живой — моложе PLAN_TTL_SEC и не закрытый позже ни
 * запуском, ни баном, ни пропуском этой игры: сказанное позже важнее плана.
 *
 * Только пишущей сессии не из демо: план — её же нажатие, и сессия по
 * ссылке его ни записать, ни прочитать не может; демо-библиотека чужая, и
 * «вечером» у неё не наступает.
 *
 * Модуль клиентский, без импортов: срок, форма и подписи; база — в lib/db.ts.
 */

/**
 * Сколько план ждёт: полтора дня. Поставил утром — сыграешь вечером; ночью —
 * следующим вечером. Дольше строка «ставил на загрузку» говорила бы уже о
 * том, что человек, скорее всего, сыграл без нас или передумал молча.
 */
export const PLAN_TTL_SEC = 36 * 3600

/** Какие intent снимка (lib/feedbackctx) — план, а не оценка */
export const PLAN_INTENTS = ['install', 'tonight'] as const

export type PlanIntent = (typeof PLAN_INTENTS)[number]

/** SQL-список тех же intent — один на все запросы lib/db.ts, чтобы не разъехались */
export const PLAN_INTENTS_SQL = PLAN_INTENTS.map((i) => `'${i}'`).join(', ')

export type EveningPlan = {
  appid: number
  name: string
  /** install — поставил на загрузку; tonight — отложил с телефона на вечер */
  intent: PlanIntent
}

/** План из ответа сервера — проверкой формы: «Ставил «undefined»» хуже, чем ничего */
export function parseEveningPlan(raw: unknown): EveningPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.appid !== 'number' || !Number.isSafeInteger(r.appid) || r.appid <= 0) return null
  if (typeof r.name !== 'string' || !r.name.trim()) return null
  const intent = PLAN_INTENTS.find((i) => i === r.intent)
  return intent ? { appid: r.appid, name: r.name, intent } : null
}

/**
 * Что было сказано — словами самого нажатия: «поставил на загрузку» и
 * «отложил на вечер» — разные обещания себе, и строка не должна их путать.
 */
export function planLine(plan: Pick<EveningPlan, 'name' | 'intent'>): string {
  return plan.intent === 'install' ? `Ставил «${plan.name}» на загрузку` : `Отложил «${plan.name}» на вечер`
}
