import { parseOutcomeAsk, playedLine } from './outcome'

/**
 * Живая строка карточки вошедшего на главной (ConnectCard): одно, что сейчас
 * стоит сказать вернувшемуся, — или спокойная дверь в библиотеку.
 *
 * Данные приезжают в ответе /api/session/touch?card=1 (поле live), и строка
 * держит место всегда — с первого кадра, ещё по подсказке из localStorage.
 * Иначе ответ сервера, пришедший через двести миллисекунд, подвинул бы
 * первый экран ровно тогда, когда в него целятся пальцем. Поэтому же строка
 * одна и в одну строку: новости не растят карточку.
 *
 * Порядок — по цене вопроса. «Как тебе?» бывает редко и нужен подбору;
 * игра дня уже выбрана — напоминание о том, что ждёт; остальное — дверь
 * в «Твои вечера».
 */
export type LiveLine = { href: string; text: string }

/** Дверь по умолчанию — и до ответа сервера, и когда сказать нечего */
export const LIVE_DEFAULT: LiveLine = {
  href: '/library#evenings',
  text: 'Твои вечера и то, что зашло, — в библиотеке',
}

/** Поле live из ответа touch — проверкой формы, а не приведением типом */
export function liveLineFrom(raw: unknown): LiveLine {
  if (!raw || typeof raw !== 'object') return LIVE_DEFAULT
  const { ask, daily } = raw as Record<string, unknown>
  const question = parseOutcomeAsk(ask)
  if (question) {
    return {
      // Ответ даётся там же, где вся история советов, — в «Твоих вечерах»
      href: '/library#evenings',
      text: `Как тебе «${question.name}»? ${playedLine(question.minutes)} после совета`,
    }
  }
  if (daily && typeof daily === 'object') {
    const { appid, name } = daily as Record<string, unknown>
    const known = typeof appid === 'number' && Number.isInteger(appid) && appid !== 0
    if (known && typeof name === 'string' && name.trim()) {
      // Строка дня уже лежит в базе — /daily откроется без прогрева
      return { href: '/daily', text: `Игра дня уже выбрана — «${name}»` }
    }
  }
  return LIVE_DEFAULT
}
