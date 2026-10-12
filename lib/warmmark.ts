/**
 * Метка прогрева — «/api/prepare сказал, что разбирать нечего» (sessionStorage,
 * 10 минут). Пока она свежая, новый запрос выдачи /play идёт без прогрева;
 * зачем и почему она привязана к тому, кто вошёл, — в lib/playcache.ts, рядом
 * с двумя другими записями выдачи на устройстве.
 *
 * ОТДЕЛЬНЫМ МОДУЛЕМ — ради веса. Метку читает и квиз (не начинать прогрев
 * заранее, если он и так свежий), а квизу больше ничего из lib/playcache не
 * нужно. Пока метка лежала там, первая загрузка /quiz везла весь разбор
 * сохранённой выдачи — lib/playcache, lib/playflow, lib/eveningplan,
 * lib/nudge, ~6 КБ (замер сборкой), — ради двух имён. lib/playcache отдаёт
 * отсюда те же имена дальше, хранилище одно на вкладку.
 */

import { createLocalStore } from './localstore'

/** Сколько метка «прогрев закончен» позволяет его пропускать, мс */
export const WARM_MARK_TTL_MS = 10 * 60_000

/**
 * Свежесть по часам клиента — одна мера на все три записи выдачи (здесь и в
 * lib/playcache). Запись «из будущего» — тоже не свежая: часы перевели назад,
 * и сколько ей на самом деле, уже не узнать.
 */
export function fresh(at: number, nowMs: number, ttlMs: number): boolean {
  const age = nowMs - at
  return age >= -60_000 && age <= ttlMs
}

export type WarmMark = { viewer: string; at: number }

export function parseWarmMark(raw: unknown): WarmMark | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.viewer !== 'string' || !r.viewer || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  return { viewer: r.viewer, at: r.at }
}

/** Можно ли пропустить прогрев: он закончился недавно, и у этого же человека. */
export function warmIsFresh(mark: WarmMark | null, viewer: string | null, nowMs: number): boolean {
  return !!mark && !!viewer && mark.viewer === viewer && fresh(mark.at, nowMs, WARM_MARK_TTL_MS)
}

/** Свежая метка без вопроса, кто вошёл, — повод этот вопрос задать. */
export function hasFreshWarm(mark: WarmMark | null, nowMs: number): boolean {
  return !!mark && fresh(mark.at, nowMs, WARM_MARK_TTL_MS)
}

export const warmMarkStore = createLocalStore('imbored.play.warm', parseWarmMark, 'session')
