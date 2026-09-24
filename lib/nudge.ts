/*
 * ПОДТАЛКИВАНИЯ ПОСЛЕ ВЫДАЧИ.
 *
 * Человек смотрит на героя и понимает не «чего хочет», а чего в нём НЕ
 * хватает: длинновато, слишком бодро, хочется чего-то своего, хочется
 * истории, или просто «не это всё». Раньше ответить на это можно было только
 * заново пройдя квиз. Теперь — одним тапом под героем, и выдача
 * пересобирается под ту же просьбу, но с поправкой:
 *
 *   shorter   — время на ступень короче; если короче уже некуда — отсечь то,
 *               во что за вечер не войти;
 *   calmer    — вайб «расслабиться»; если он уже такой — отсечь напряжённое;
 *   familiar  — только своё, и заброшенное давно — чуть вперёд (×1.3);
 *   story     — прибавка к настроению за Story Rich и Narrative;
 *   different — другой срез пула каталога, без того, что уже на экране, и
 *               ×0.8 тем, кто похож на показанное главными тегами.
 *
 * Это поправка к подбору, а не новый повод звать модель: выдача по
 * подталкиванию собирается эвристикой (см. /api/recommend) — правило
 * владельца «никакого нового расхода на модель».
 *
 * Модуль без импортов значений: список и подписи читает /play.
 */

import type { Scope } from './recommend'
import type { CandidateSource, Mood } from './types'

export const NUDGES = ['shorter', 'calmer', 'familiar', 'story', 'different'] as const

export type Nudge = (typeof NUDGES)[number]

/** Подписи чипсов на /play — в том же порядке, что NUDGES */
export const NUDGE_LABEL: Record<Nudge, string> = {
  shorter: 'Покороче',
  calmer: 'Поспокойнее',
  familiar: 'Знакомое',
  story: 'Про историю',
  different: 'Что-то другое',
}

/** Мусор — «без подталкивания», а не 400: у каждого кода отказа на /play свой экран */
export function parseNudge(raw: unknown): Nudge | null {
  return typeof raw === 'string' && (NUDGES as readonly string[]).includes(raw) ? (raw as Nudge) : null
}

/**
 * Сколько appid «уже на экране» принимается. Выдача — пять карточек и до
 * шести на полке покупок; тридцать — с запасом на два-три «Что-то другое»
 * подряд, а не на список всего каталога.
 */
export const EXCLUDE_MAX = 30

/**
 * Что уже показано: только ненулевые целые, без повторов, не больше
 * EXCLUDE_MAX. Всё прочее молча отбрасывается — отказ по кривому полю стоил
 * бы человеку выдачи.
 */
export function parseExclude(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<number>()
  for (const x of raw) {
    if (out.size >= EXCLUDE_MAX) break
    if (typeof x === 'number' && Number.isSafeInteger(x) && x !== 0) out.add(x)
  }
  return [...out]
}

/** Время на ступень короче; у «меньше часа» ступени нет — там отсекается длинное */
const SHORTER: Record<Mood['time'], Mood['time']> = { long: 'medium', medium: 'short', short: 'short' }

/**
 * «Про историю» — прибавка к настроению, того же размера, что совпадение
 * вайба (+0.25 в moodMultiplier): история становится ещё одной осью
 * настроения, а не фильтром. Два тега об одном — одна прибавка, не две.
 */
const STORY_BOOST: Record<string, number> = { 'Story Rich': 0.25, Narrative: 0.25 }

/**
 * «Знакомое»: заброшенное давно — вперёд. Свой наклон к знакомому любимому у
 * него уже есть (familiarWeight, ось familiar), здесь — к тому, что человек
 * бросил полгода назад и помнит руками.
 */
const FAMILIAR_SOURCE_WEIGHT: Partial<Record<CandidateSource, number>> = { comeback: 1.3 }

/**
 * Во что превращается подталкивание — до базы и до скоринга.
 *
 *   cut          — что отсечь сверх настроения (cutByNudge в lib/recommend):
 *                  'long' — заход дольше вечера, 'intense' — напряжённое;
 *   sourceWeight — наклон источников сверх обычного;
 *   tagBoost     — прибавка к настроению за теги;
 *   reroll       — «Что-то другое»: другой срез пула, без показанного и со
 *                  штрафом похожести на него.
 */
export type NudgePlan = {
  mood: Mood
  scope: Scope
  cut: 'long' | 'intense' | null
  sourceWeight: Partial<Record<CandidateSource, number>> | null
  tagBoost: Record<string, number> | null
  reroll: boolean
}

export function planNudge(nudge: Nudge | null, mood: Mood, scope: Scope): NudgePlan {
  const plan: NudgePlan = { mood, scope, cut: null, sourceWeight: null, tagBoost: null, reroll: false }
  switch (nudge) {
    case 'shorter':
      return mood.time === 'short'
        ? { ...plan, cut: 'long' }
        : { ...plan, mood: { ...mood, time: SHORTER[mood.time] } }
    case 'calmer':
      return mood.vibe === 'chill'
        ? { ...plan, cut: 'intense' }
        : { ...plan, mood: { ...mood, vibe: 'chill' } }
    case 'familiar':
      return { ...plan, scope: 'library', sourceWeight: FAMILIAR_SOURCE_WEIGHT }
    case 'story':
      return { ...plan, tagBoost: STORY_BOOST }
    case 'different':
      return { ...plan, reroll: true }
    case null:
      return plan
  }
}
