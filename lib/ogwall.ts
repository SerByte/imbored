/**
 * Стена постеров для карточек next/og — раскладка без JSX.
 *
 * Тот же жест, что у героя портрета на сайте (.portrait-wall): постеры
 * колонками, чётные колонки сдвинуты вниз, вся стена чуть повёрнута. satori не
 * знает grid, поэтому стена — ряд колонок-флексов, а поворот — transform у
 * контейнера (вокруг его центра).
 *
 * Постеров всегда меньше, чем клеток: уникальный адрес — это отдельная
 * загрузка при рендере, а повтор бесплатен. Клетки заполняются построчно
 * по кругу, как стена на странице: самая наигранная игра — в левом верхнем
 * углу, где начинается взгляд.
 */

export type WallSpec = {
  cols: number
  rows: number
  cellW: number
  cellH: number
  gap: number
  /** Поворот стены, градусы; минус — против часовой */
  angleDeg: number
  /** Сдвиг нечётных колонок вниз */
  stagger: number
  /** Положение стены на холсте до поворота */
  left: number
  top: number
}

/** Холсты карточек: OG и сторис */
export const CANVAS_WIDE = { width: 1200, height: 630 } as const
export const CANVAS_TALL = { width: 1080, height: 1350 } as const

/** OG 1200×630 */
export const WALL_WIDE: WallSpec = {
  cols: 9,
  rows: 4,
  cellW: 150,
  cellH: 225,
  gap: 12,
  angleDeg: -6,
  stagger: 50,
  left: -123,
  top: -160,
}

/** Карточка 1080×1350 */
export const WALL_TALL: WallSpec = {
  cols: 6,
  rows: 5,
  cellW: 240,
  cellH: 360,
  gap: 14,
  angleDeg: -6,
  stagger: 80,
  left: -215,
  top: -290,
}

/** Размер стены до поворота */
export function wallSize(spec: WallSpec): { width: number; height: number } {
  return {
    width: spec.cols * spec.cellW + (spec.cols - 1) * spec.gap,
    height: spec.rows * spec.cellH + (spec.rows - 1) * spec.gap + spec.stagger,
  }
}

/** Клетки по колонкам: items[i % n] построчно; пустой список — пустая стена */
export function wallColumns<T>(items: readonly T[], spec: Pick<WallSpec, 'cols' | 'rows'>): T[][] {
  if (!items.length) return []
  return Array.from({ length: spec.cols }, (_, col) =>
    Array.from({ length: spec.rows }, (_, row) => items[(row * spec.cols + col) % items.length]!),
  )
}

/**
 * Закрывает ли повёрнутая стена весь холст — без голых углов. Проверяются
 * углы холста: их переводят в систему стены (обратный поворот вокруг её
 * центра) и смотрят, лежат ли они в той полосе, где клетки есть у всех
 * колонок — ниже сдвига нечётных и выше конца чётных.
 */
export function wallCovers(spec: WallSpec, canvas: { width: number; height: number }): boolean {
  const { width, height } = wallSize(spec)
  const cx = spec.left + width / 2
  const cy = spec.top + height / 2
  const a = (-spec.angleDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const minY = spec.top + spec.stagger
  const maxY = spec.top + height - spec.stagger
  for (const [x, y] of [
    [0, 0],
    [canvas.width, 0],
    [0, canvas.height],
    [canvas.width, canvas.height],
  ] as const) {
    const dx = x - cx
    const dy = y - cy
    const wx = cx + dx * cos - dy * sin
    const wy = cy + dx * sin + dy * cos
    if (wx < spec.left || wx > spec.left + width || wy < minY || wy > maxY) return false
  }
  return true
}
