/**
 * Цена входа и «время до веселья» — без модели.
 *
 * «Во что поиграть» спрашивают вечером, и у вечера есть бюджет. Игра, которая
 * раскрывается через три часа обучения, и игра, где весело с первой минуты, —
 * разные ответы на один и тот же вопрос, а карточка до сих пор говорила о них
 * одинаково. Теперь говорит, но только то, что мы знаем.
 *
 * Два источника, и старший — отзывы:
 *
 *   1. Семантика (lib/semantics) с уверенностью SEMANTICS_MIN_CONFIDENCE, то
 *      есть уточнённая отзывами: её timeToFun — это «gets good after N hours»
 *      и «раскачивается» из самих отзывов (lib/reviewmine). Если уверенная
 *      семантика не видит ни медленного, ни быстрого старта, это тоже ответ:
 *      теги её не переспорят, строки нет.
 *   2. Теги — два коротких списка жанров, где порог входа — свойство самого
 *      жанра. Игра сразу в обоих (Casual Automation) — спор, и строки нет.
 *
 * Модуль клиентобезопасный: строку рисует /play, решение принимает сервер.
 */
import { plural } from './plural'
import { SEMANTICS_MIN_CONFIDENCE } from './semantics'
import type { CandidateSource, GameMeta } from './types'

export type EntryCost = {
  /** high — раскрывается не сразу; low — весело с первых минут */
  level: 'low' | 'high'
  /** Через сколько часов раскрывается — число из отзывов (медиана); null — его не называли */
  hours: number | null
  /** Откуда вывод: разбор отзывов или жанр по тегам — строка говорит об этом честно */
  basis: 'reviews' | 'tags'
}

/** Жанры, где до веселья надо дорасти: освоить экономику, выучить мувсет боссов */
export const ENTRY_HIGH_TAGS = [
  'Grand Strategy',
  '4X',
  'Souls-like',
  'Difficult',
  'CRPG',
  'Management',
  'Automation',
]

/** Жанры, где весело с первого захода */
export const ENTRY_LOW_TAGS = ['Arcade', 'Casual', 'Roguelite', 'Party Game', 'Racing']

export function entryCost(meta: Pick<GameMeta, 'tags' | 'semantics'>): EntryCost | null {
  const s = meta.semantics
  if (s && s.confidence >= SEMANTICS_MIN_CONFIDENCE) {
    const bucket = s.timeToFun.bucket
    if (bucket === null) return null
    return { level: bucket === 'slow' ? 'high' : 'low', hours: s.timeToFun.hours, basis: 'reviews' }
  }
  const tags = meta.tags ?? {}
  const high = ENTRY_HIGH_TAGS.some((t) => t in tags)
  const low = ENTRY_LOW_TAGS.some((t) => t in tags)
  // Оба списка — спор, ни одного — не знаем: в обоих случаях молчим
  if (high === low) return null
  return { level: high ? 'high' : 'low', hours: null, basis: 'tags' }
}

/**
 * Кому строка про вход что-то сообщает: тому, кто игру ещё не осваивал.
 * У знакомого любимого управление в руках — «порог входа высокий» спорил бы с
 * его же причиной («ничего осваивать не надо»), а у заброшенной про вход
 * говорит сама причина: вспомнить управление — не то же, что выучить.
 */
export function showsEntry(source: CandidateSource): boolean {
  return source === 'untouched' || source === 'backlog' || source === 'new'
}

/**
 * Строка карточки. Про отзывы — со ссылкой на них, про теги — как про жанр:
 * «Порог входа высокий» у Grand Strategy — не наше мнение, а свойство жанра.
 * Часы — целым числом и не меньше одного: «через 0 часов» не бывает.
 */
export function entryLine(e: EntryCost): string {
  if (e.level === 'high') {
    if (e.hours !== null) {
      const h = Math.max(1, Math.round(e.hours))
      return `Раскрывается не сразу: по отзывам — через ${h} ${plural(h, 'час', 'часа', 'часов')}`
    }
    return e.basis === 'reviews'
      ? 'Раскрывается не сразу — так пишут в отзывах'
      : 'Порог входа высокий: сначала придётся разобраться'
  }
  return e.basis === 'reviews'
    ? 'Затягивает с первых минут — так пишут в отзывах'
    : 'Порог входа низкий: сел и играешь'
}
