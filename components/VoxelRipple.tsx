'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useRef, useState } from 'react'

gsap.registerPlugin(useGSAP)

/**
 * Волна кубов по нажатию на арт — пасхалка для воксельных игр.
 *
 * Основа: React Bits «Cubes» (reactbits.dev/animations/cubes, MIT). От оригинала
 * взяты сетка и разбиение по кольцам вокруг точки нажатия; остальное переделано,
 * потому что в исходном виде компонент здесь ломает продукт:
 *
 * 1. Грани непрозрачные (#120F17 + сплошная белая рамка) — сетка в покое была бы
 *    стеной поверх ключ-арта. Здесь покой означает невидимость: --voxel-on: 0
 *    гасит и заливку, и рамку.
 * 2. touchmove навешивался с { passive: false } и звал preventDefault() — это
 *    убивало скролл страницы на всей площади оверлея. Слушателей движения нет
 *    вообще, только нажатие.
 * 3. autoAnimate крутил бесконечный rAF-цикл. Вырезан целиком: у этого эффекта
 *    не должно быть фонового движения, он одноразовый.
 * 4. Оригинал твинит backgroundColor у каждой грани — на сетке 15×15 это больше
 *    тысячи цветовых твинов, и анимация от «прозрачного» интерполирует через
 *    чёрный. Здесь на куб приходится одна числовая переменная, а цвет считает
 *    CSS: втрое меньше твинов и чистая альфа.
 *
 * Компонент рендерится внутри секции с key={pick.appid}, поэтому смена игры
 * размонтирует его и гасит волну сама — сбрасывать состояние снаружи не нужно.
 */

/** Нечётный размер сетки: нужна настоящая центральная ячейка под точкой нажатия. */
const GRID_MOBILE = 11
const GRID_DESKTOP = 15
const SPEED = 2.2
const SPREAD = 0.15 / SPEED
const DUR = 0.3 / SPEED
const HOLD = 0.6 / SPEED
/** Порог, отделяющий тап от начала скролла. */
const TAP_SLOP = 8
const TAP_MS = 500

type Burst = { left: number; top: number; grid: number; cube: number; gap: number }

export function VoxelRipple() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const [burst, setBurst] = useState<Burst | null>(null)

  function fire(clientX: number, clientY: number) {
    // Пока волна идёт, новые нажатия игнорируем: две сетки разом удваивают DOM,
    // а очередь из пасхалок перестаёт быть пасхалкой.
    if (burst) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const host = hostRef.current
    if (!host) return

    const rect = host.getBoundingClientRect()
    const grid = rect.width < 640 ? GRID_MOBILE : GRID_DESKTOP
    const span = Math.min(Math.max(rect.width, rect.height) * 1.15, 1200)
    const cube = Math.round(span / grid)
    const gap = Math.round(cube * 0.18)
    const total = grid * cube + (grid - 1) * gap

    // Квадрат центрируем на точке нажатия — тогда её ячейка и есть центр сетки,
    // и попадание не нужно вычислять отдельно. Секция overflow-hidden обрежет края.
    setBurst({
      left: clientX - rect.left - total / 2,
      top: clientY - rect.top - total / 2,
      grid,
      cube,
      gap,
    })
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse') {
      fire(e.clientX, e.clientY)
      return
    }
    // На тач-вводе ждём отпускания: иначе каждый скролл по герою пускал бы волну.
    downRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = downRef.current
    downRef.current = null
    if (!d || e.pointerType === 'mouse') return
    if (e.timeStamp - d.t > TAP_MS) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return
    fire(e.clientX, e.clientY)
  }

  useGSAP(
    () => {
      const scene = sceneRef.current
      if (!burst || !scene) return

      const cubes = Array.from(scene.querySelectorAll<HTMLElement>('.voxel-cube'))
      const mid = (burst.grid - 1) / 2
      const rings = new Map<number, HTMLElement[]>()
      for (const cube of cubes) {
        const r = Number(cube.dataset.row)
        const c = Number(cube.dataset.col)
        const ring = Math.round(Math.hypot(r - mid, c - mid))
        const bucket = rings.get(ring)
        if (bucket) bucket.push(cube)
        else rings.set(ring, [cube])
      }

      const tl = gsap.timeline({ onComplete: () => setBurst(null) })
      for (const ring of [...rings.keys()].sort((a, b) => a - b)) {
        const at = ring * SPREAD
        const group = rings.get(ring)!
        // Наклон — это то, что делает их кубами, а не квадратами
        tl.to(group, { '--voxel-on': 1, duration: DUR, ease: 'power3.out' }, at)
          .to(group, { rotateX: -28, rotateY: 28, duration: DUR, ease: 'power3.out' }, at)
          .to(
            group,
            { '--voxel-on': 0, duration: DUR * 2, ease: 'power2.in' },
            at + DUR + HOLD,
          )
          .to(
            group,
            { rotateX: 0, rotateY: 0, duration: DUR * 2, ease: 'power2.inOut' },
            at + DUR + HOLD,
          )
      }

      return () => {
        tl.kill()
      }
    },
    { scope: sceneRef, dependencies: [burst] },
  )

  return (
    <>
      {/* Поверхность нажатия. Не <button>: она декоративная и не должна попадать
          ни в порядок обхода, ни в озвучку — как .grain и BlurBand рядом. */}
      <div
        ref={hostRef}
        aria-hidden
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          downRef.current = null
        }}
      />

      {burst && (
        <div
          ref={sceneRef}
          aria-hidden
          className="voxel-scene absolute"
          style={{
            left: burst.left,
            top: burst.top,
            gap: burst.gap,
            gridTemplateColumns: `repeat(${burst.grid}, ${burst.cube}px)`,
            ['--voxel-half' as string]: `${burst.cube / 2}px`,
          }}
        >
          {Array.from({ length: burst.grid * burst.grid }, (_, i) => (
            <div
              key={i}
              className="voxel-cube"
              data-row={Math.floor(i / burst.grid)}
              data-col={i % burst.grid}
              style={{ width: burst.cube, height: burst.cube }}
            >
              <span className="voxel-face voxel-face-front" />
              <span className="voxel-face voxel-face-top" />
              <span className="voxel-face voxel-face-right" />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
