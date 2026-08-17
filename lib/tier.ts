/**
 * Уровень исполнения квиза. ТОЛЬКО ПОНИЖЕНИЕ.
 *
 * Базовый CSS без атрибута — это законченный дизайн, а не заготовка. Уровень
 * не монтирует и не размонтирует ни одного компонента: он крутит ручки
 * (--fx-bloom, --fx-ab, --fx-gel, --fx-art-tween) и гасит один эмбиент-слой.
 * Каждая сцена присутствует на каждом уровне — меняется толщина, не содержание.
 *
 * Почему нет повышения. Повышение — единственное направление, в котором слои
 * могут ВСКОЧИТЬ на глазах; ради него пришлось бы держать парс-таймовый скрипт,
 * кэш в sessionStorage и окно наблюдения, и разбираться с вспышкой не того
 * уровня. Понижение не может ошибиться так, чтобы сломать дизайн: в худшем
 * случае мощная машина покажет чуть более скромную картинку.
 *
 * Чего здесь намеренно НЕТ:
 *   prefers-reduced-motion — укачивание это не сигнал GPU. Свести его к 'lean'
 *     значило бы снять гало и фринж, а это сигналы состояния (см. закон
 *     приведённого движения в globals.css).
 *   saveData — дизайн не везёт ни одного лишнего байта медиа.
 *   размер вьюпорта — вьюпорт это не кремний. Флагманский телефон обязан
 *     получить 'full'; курсорные артефакты отсекаются @media (hover: hover),
 *     без единой строки JS.
 */

export type Tier = 'full' | 'lean'

export type TierSignals = {
  /** navigator.deviceMemory — нет в Safari и Firefox */
  memory?: number
  /** navigator.hardwareConcurrency */
  cores?: number
  /** кадров дольше 24 мс за окно наблюдения */
  longFrames: number
  /** сколько кадров всего измерено */
  sampled: number
}

/** Кадр дольше этого считается провалом бюджета 60 Гц с запасом. */
export const LONG_FRAME_MS = 24

/** Ниже этого числа кадров выборка не считается показательной. */
const SAMPLE_FLOOR = 60

/** Доля провальных кадров, после которой уровень понижается. */
const LONG_FRAME_SHARE = 0.15

/**
 * Отсутствующий сигнал — НЕ повод понижать: в Safari и Firefox нет ни
 * deviceMemory, ни надёжного способа его узнать, и понижать там всех значило бы
 * наказать половину аудитории за молчание браузера.
 */
export function tierFrom(s: TierSignals): Tier {
  if ((s.cores ?? 8) <= 2) return 'lean'
  if ((s.memory ?? 8) <= 2) return 'lean'
  if (s.sampled >= SAMPLE_FLOOR && s.longFrames / s.sampled > LONG_FRAME_SHARE) return 'lean'
  return 'full'
}

/**
 * deviceMemory отсутствует в lib.dom.d.ts, а tsconfig стоит на strict — прямое
 * обращение это TS2339 и КРАСНАЯ СБОРКА, а не красный тест. Тип расширяется
 * локально; declare global протёк бы нестандартным API во все файлы проекта.
 */
export function readSignals(): Pick<TierSignals, 'memory' | 'cores'> {
  if (typeof navigator === 'undefined') return {}
  const nav = navigator as Navigator & { deviceMemory?: number }
  return { memory: nav.deviceMemory, cores: nav.hardwareConcurrency }
}
