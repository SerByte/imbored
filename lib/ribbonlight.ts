/**
 * СВЕТ ЛЕНТЫ: ОДНА ШКАЛА НА ВСЮ СТРАНИЦУ.
 *
 * Это не стиль, а вывод из дефекта прототипа, и он стоит того, чтобы быть
 * записанным здесь целиком.
 *
 * Первым делом свет ленты двигали сами сцены: каждая заводила скрубленный твин
 * на общий объект состояния. Работало ровно до перехода между сценами. У
 * скрубленного твина есть СВОЁ запомненное начальное значение, и на прогрессе 0
 * он его возвращает — а запоминается оно при первом рендере твина, то есть до
 * того, как предыдущая сцена что-либо изменила. На входе в четвёртую сцену
 * лента поэтому вспыхивала на полную яркость, хотя третья только что погасила
 * её до 13%.
 *
 * Теперь состояние считается ОТ ПОЗИЦИИ ПРОКРУТКИ по списку опорных точек:
 * никаких твинов, никакого спора за объект, и движение назад отыгрывается ровно
 * так же, как вперёд. Здесь — чистая математика этого счёта, отдельно от DOM,
 * чтобы её можно было проверить прогоном, а не глазами.
 */

export type RibbonState = {
  /** Множитель скорости дрейфа колонок. 0 — лента стоит. */
  speed: number
  /** Насыщенность: 0 — обесцвечено. */
  sat: number
  /** Прозрачность слоя. */
  opacity: number
}

/**
 * Опорная точка. `scene` — идентификатор закреплённой сцены, `k` — доля внутри
 * её диапазона закрепления (0 — начало, 1 — конец). `scene: null` означает верх
 * документа.
 */
export type RibbonStop = RibbonState & {
  scene: string | null
  k: number
}

/** Границы закрепления сцены в пикселях прокрутки. */
export type SceneRange = { start: number; end: number }

export type ResolvedStop = RibbonState & { y: number }

/** Покой ленты: с ним она встречает человека и им же провожает. */
export const RIBBON_REST: RibbonState = { speed: 1, sat: 0.92, opacity: 0.5 }

/**
 * Партитура света. Читается сверху вниз как путь по странице.
 *
 * Числа выбраны на живой странице, а не по вкусу, и у каждой группы своя
 * причина:
 *
 * - В герое лента — главное, что есть в кадре, поэтому она видна и разгоняется
 *   к концу первого экрана: уход первого экрана читается как «поехали».
 * - В сцене боли она ЗАМИРАЕТ и СЕДЕЕТ. Это и есть аргумент сцены: «ничего не
 *   цепляет» показано фоном, а не сказано словами.
 * - Во всех сценах с обложками (подбор, совместимость, репертуар) лента уходит
 *   почти в ноль. Обложки на обложках не читаются: стена демо-библиотеки
 *   спорила бы с точно такими же картинками за спиной.
 * - В финале свет возвращается — но только после того, как текст прочитан,
 *   иначе позиция про деньги читается поверх мельтешения.
 */
export const RIBBON_SCORE: readonly RibbonStop[] = [
  { scene: null, k: 0, ...RIBBON_REST },
  { scene: 'pain', k: 0, speed: 2, sat: 0.92, opacity: 0.5 },
  { scene: 'pain', k: 0.62, speed: 0.05, sat: 0, opacity: 0.2 },
  { scene: 'engine', k: 0, speed: 0.4, sat: 0.92, opacity: 0.13 },
  { scene: 'compat', k: 0, speed: 0.32, sat: 0.92, opacity: 0.14 },
  { scene: 'more', k: 0, speed: 0.3, sat: 0.92, opacity: 0.13 },
  { scene: 'money', k: 0, speed: 0.3, sat: 0.92, opacity: 0.13 },
  { scene: 'money', k: 0.55, speed: 1.6, sat: 0.92, opacity: 0.5 },
]

/**
 * Развернуть партитуру в точки на оси прокрутки.
 *
 * Сцены, которых ещё нет в разметке (страница не разложена, закрепления не
 * посчитаны), просто выпадают: лучше короткая верная шкала, чем длинная с
 * нулями. Точки сортируются по позиции — порядок в партитуре описывает замысел,
 * а не гарантирует арифметику.
 */
export function resolveStops(
  score: readonly RibbonStop[],
  ranges: Readonly<Record<string, SceneRange>>,
): ResolvedStop[] {
  const out: ResolvedStop[] = []
  for (const stop of score) {
    let y: number
    if (stop.scene === null) {
      y = 0
    } else {
      const range = ranges[stop.scene]
      if (!range) continue
      y = range.start + (range.end - range.start) * stop.k
    }
    out.push({ y, speed: stop.speed, sat: stop.sat, opacity: stop.opacity })
  }
  return out.sort((a, b) => a.y - b.y)
}

/** Линейная доля между двумя точками; вырожденный отрезок даёт 0. */
function ratio(y: number, a: number, b: number): number {
  const span = b - a
  if (span <= 0) return 0
  const k = (y - a) / span
  return k < 0 ? 0 : k > 1 ? 1 : k
}

/**
 * Состояние ленты на позиции `y`.
 *
 * За пределами шкалы — крайние значения, а не экстраполяция: выше первой точки
 * человек ещё не начал читать, ниже последней уже дочитал, и в обоих случаях
 * лента обязана стоять в том состоянии, к которому её привели.
 */
export function sampleRibbon(y: number, stops: readonly ResolvedStop[]): RibbonState {
  if (stops.length === 0) return { ...RIBBON_REST }
  if (stops.length === 1 || y <= stops[0].y) {
    const s = stops[0]
    return { speed: s.speed, sat: s.sat, opacity: s.opacity }
  }
  const last = stops[stops.length - 1]
  if (y >= last.y) return { speed: last.speed, sat: last.sat, opacity: last.opacity }

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (y >= a.y && y <= b.y) {
      const k = ratio(y, a.y, b.y)
      return {
        speed: a.speed + (b.speed - a.speed) * k,
        sat: a.sat + (b.sat - a.sat) * k,
        opacity: a.opacity + (b.opacity - a.opacity) * k,
      }
    }
  }
  return { speed: last.speed, sat: last.sat, opacity: last.opacity }
}
