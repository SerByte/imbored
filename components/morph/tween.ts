/**
 * Твин одного числа на requestAnimationFrame — вместо gsap в слайдере кадров.
 *
 * Слайдеру gsap нужен был ровно для одного: довести uProgress униформа от 0
 * до 1 с кривой. Ради этого ядро gsap (70 КБ) ехало в ленивый чанк /game и
 * героя /play и /daily. Кадр рисует собственный цикл слайдера — здесь только
 * значение и конец.
 *
 * Имена кривых — те же, что понимал gsap (power1–4, sine, expo, none;
 * .in / .out / .inOut): их передают снаружи пропом ease, и страницы
 * менять не пришлось. Незнакомое имя — power2.out, штатная кривая gsap.
 */

export type Ease = (t: number) => number

function power(p: number, kind: string): Ease {
  if (kind === 'in') return (t) => t ** p
  if (kind === 'inOut') return (t) => (t < 0.5 ? (2 * t) ** p / 2 : 1 - (2 * (1 - t)) ** p / 2)
  return (t) => 1 - (1 - t) ** p
}

const SINE: Record<string, Ease> = {
  in: (t) => 1 - Math.cos((t * Math.PI) / 2),
  out: (t) => Math.sin((t * Math.PI) / 2),
  inOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
}

const EXPO: Record<string, Ease> = {
  in: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  out: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOut: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
}

export function easeByName(name: string): Ease {
  const [family, kind = 'out'] = name.split('.')
  if (family === 'none' || family === 'linear') return (t) => t
  const pw = /^power([1-4])$/.exec(family)
  if (pw) return power(Number(pw[1]) + 1, kind)
  if (family === 'sine') return SINE[kind] ?? SINE.out
  if (family === 'expo') return EXPO[kind] ?? EXPO.out
  return power(3, 'out')
}

export type Tween = { kill(): void }

/** Ведёт target.value к `to` за duration секунд; from — стартовое значение, если задано */
export function tweenValue(
  target: { value: unknown },
  opts: { to: number; duration: number; ease: string; from?: number; onComplete?: () => void },
): Tween {
  const ease = easeByName(opts.ease)
  const start = opts.from ?? (target.value as number)
  target.value = start
  const t0 = performance.now()
  let raf = 0
  let dead = false
  const step = (now: number) => {
    if (dead) return
    const k = opts.duration <= 0 ? 1 : Math.min(1, (now - t0) / (opts.duration * 1000))
    target.value = start + (opts.to - start) * ease(k)
    if (k < 1) raf = requestAnimationFrame(step)
    else opts.onComplete?.()
  }
  raf = requestAnimationFrame(step)
  return {
    kill() {
      dead = true
      cancelAnimationFrame(raf)
    },
  }
}
