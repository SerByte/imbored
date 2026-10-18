import { parseEveningPlan, planLine } from './eveningplan'
import { tr, type Locale } from './i18n'
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
 * план на вечер (lib/eveningplan.ts) — решение самого человека, и оно
 * важнее того, что сегодня выбрали за него; игра дня уже выбрана —
 * напоминание о том, что ждёт; остальное — дверь в «Твои вечера».
 */
export type LiveLine = { href: string; text: string }

/** Дверь по умолчанию — и до ответа сервера, и когда сказать нечего */
export const LIVE_DEFAULT: LiveLine = {
  // Без якоря: у того, кому ещё ничего не советовали, блока «Твои вечера» нет
  href: '/library',
  text: 'Твои вечера и то, что зашло, — в библиотеке',
}

/**
 * Дверь по умолчанию на каждом языке — постоянными объектами, а не новым на
 * каждый вызов: карточка кладёт её в useState до ответа сервера, а тест
 * сверяет «нечего сказать» с ней же. Адрес — без префикса языка, как и у
 * остальных строк: ссылку рисует Link, он префикс и ставит.
 */
const LIVE_DEFAULTS = {
  ru: LIVE_DEFAULT,
  en: { href: '/library', text: 'Your evenings and what you liked — in your library' },
} as const satisfies Record<Locale, LiveLine>

export function liveDefault(locale: Locale = 'ru'): LiveLine {
  return LIVE_DEFAULTS[locale]
}

/** Поле live из ответа touch — проверкой формы, а не приведением типом */
export function liveLineFrom(raw: unknown, locale: Locale = 'ru'): LiveLine {
  if (!raw || typeof raw !== 'object') return liveDefault(locale)
  const { ask, plan, daily } = raw as Record<string, unknown>
  const question = parseOutcomeAsk(ask)
  if (question) {
    // Сыгранное — на языке строки (playedLine): «2 ч 15 мин» / «2 h 15 min»,
    // а шаблон вокруг у каждого языка свой, целой фразой
    const played = playedLine(question.minutes, locale)
    return {
      // Ответ даётся там же, где вся история советов, — в «Твоих вечерах»
      href: '/library#evenings',
      text: tr(locale, {
        ru: `Как тебе «${question.name}»? ${played} после совета`,
        en: `How's “${question.name}”? ${played} played since our pick`,
      }),
    }
  }
  const planned = parseEveningPlan(plan)
  if (planned) {
    // На страницу игры, а не прямо в steam://: строка стоит и на телефоне, а
    // «Запустить» там дорисовывает владельцу OwnedLaunch — и этот запуск
    // закрывает план (plan в /api/session/owns). Без «запустить?»: на
    // телефоне OwnedLaunch не рисуется вовсе (steam:// там мёртв), и вопрос
    // вёл бы к странице без такой кнопки — тот же упрёк, от которого строку
    // плана на /play прячет pointer-fine. «Ждёт» правда на обоих устройствах
    return {
      href: `/game/${planned.appid}`,
      text: tr(locale, {
        ru: `${planLine(planned, locale)} — ждёт тебя`,
        en: `${planLine(planned, locale)} — it's waiting for you`,
      }),
    }
  }
  if (daily && typeof daily === 'object') {
    const { appid, name } = daily as Record<string, unknown>
    const known = typeof appid === 'number' && Number.isInteger(appid) && appid !== 0
    if (known && typeof name === 'string' && name.trim()) {
      // Строка дня уже лежит в базе — /daily откроется без прогрева
      return {
        href: '/daily',
        text: tr(locale, { ru: `Игра дня уже выбрана — «${name}»`, en: `Your game of the day is ready — “${name}”` }),
      }
    }
  }
  return liveDefault(locale)
}
