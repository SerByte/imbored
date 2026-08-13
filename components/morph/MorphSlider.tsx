'use client'

/**
 * MorphSlider — слайдер, где кадры перетекают друг в друга через displacement.
 *
 * Источник: reactbits.dev/r/MorphSlider-TS-CSS. Шейдеры и логика движка взяты
 * как есть, правки внесены только там, где вендорный код не стыковался с
 * приложением. Каждая — с причиной:
 *
 * 1. Стили переехали в CSS-модуль (см. шапку MorphSlider.module.css). Движок
 *    ставит класс канвасу императивно, поэтому хэшированное имя приходит к нему
 *    через конфиг — иначе канвас остался бы без размеров.
 * 2. Появились onChange и onActivate. Первый нужен родителю, чтобы знать
 *    текущий кадр (движок и так считает его внутри, наружу это просто не было
 *    выведено); второй отличает клик от протяжки — на нём держится лайтбокс.
 * 3. goToIndex вместо шага на единицу. В исходнике клик по точке делал
 *    goTo(i > index ? 1 : -1), то есть листал ровно на один кадр: шестая точка
 *    уводила на вторую. Теперь переход идёт к выбранному кадру по кратчайшей
 *    дуге.
 * 4. Выброшены DEFAULT_ITEMS с ссылками на Unsplash: items приходят всегда, а
 *    четыре внешние ссылки в проде не нужны.
 * 5. Подписи для скринридера — по-русски, как всё остальное приложение.
 */

import { gsap } from 'gsap'
import { Mesh, Program, Renderer, Texture, Triangle } from 'ogl'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import styles from './MorphSlider.module.css'

export type MorphTransition = 'melt' | 'ripple' | 'shear' | 'swirl'

export interface MorphItem {
  image: string
  caption?: string
}

export interface MorphSliderProps {
  items: MorphItem[]
  startIndex?: number
  transition?: MorphTransition
  duration?: number
  ease?: string
  intensity?: number
  scale?: number
  aberration?: number
  drift?: number
  autoplay?: boolean
  autoplayDelay?: number
  loop?: boolean
  radius?: number
  overlayColor?: string
  showCaptions?: boolean
  showControls?: boolean
  showIndicators?: boolean
  className?: string
  /** Ярлык всей карусели для скринридера */
  label?: string
  /** Текущий кадр сменился — индекс уже актуален */
  onChange?: (index: number) => void
  /** Клик по сцене без протяжки: у слайдера нет своего действия, решает родитель */
  onActivate?: () => void
}

interface EngineOptions {
  transition: MorphTransition
  duration: number
  ease: string
  intensity: number
  scale: number
  aberration: number
  drift: number
  overlayColor: string
  loop: boolean
}

type GL = Renderer['gl']

const TRANSITIONS: Record<MorphTransition, number> = { melt: 0, ripple: 1, shear: 2, swirl: 3 }

/** Сколько пикселей и миллисекунд «клик» ещё остаётся кликом, а не протяжкой */
const TAP_SLOP = 5
const TAP_MS = 500

const vertexShader = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const fragmentShader = `
precision highp float;

uniform sampler2D tCurrent;
uniform sampler2D tNext;
uniform vec2 uResolution;
uniform vec2 uCurrentSize;
uniform vec2 uNextSize;
uniform float uProgress;
uniform float uDir;
uniform int uMode;
uniform float uIntensity;
uniform float uScale;
uniform float uAberration;
uniform float uDrift;
uniform float uTime;
uniform float uReduce;
uniform vec2 uPointer;
uniform vec3 uOverlay;

varying vec2 vUv;

const float PI = 3.14159265359;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

vec2 coverUV(vec2 uv, vec2 res, vec2 img) {
  float rA = res.x / max(res.y, 1.0);
  float iA = img.x / max(img.y, 1.0);
  vec2 s = vec2(1.0);
  float ratio = rA / max(iA, 0.0001);
  if (ratio > 1.0) {
    s.y = 1.0 / ratio;
  } else {
    s.x = ratio;
  }
  return (uv - 0.5) * s + 0.5;
}

void main() {
  float p = clamp(uProgress, 0.0, 1.0);
  float env = sin(p * PI);

  vec2 uv = vUv;

  uv += vec2(sin(uTime * 0.25 + uv.y * 4.0), cos(uTime * 0.22 + uv.x * 4.0)) * uDrift * 0.008;
  uv = (uv - 0.5) * (1.0 - uDrift * 0.02 * sin(uTime * 0.4)) + 0.5;

  vec2 uvC = uv;
  vec2 uvN = uv;
  float m = smoothstep(0.0, 1.0, p);

  if (uReduce < 0.5) {
    if (uMode == 3) {
      vec2 c = uv - 0.5;
      float r = length(c);
      float ang = env * uIntensity * 3.5 * (1.0 - r);
      uvC = rot(ang) * c + 0.5;
      uvN = rot(-ang) * c + 0.5;
      m = smoothstep(0.0, 1.0, p);
    } else if (uMode == 1) {
      float d = distance(uv, uPointer);
      float ring = p * 1.6;
      float wave = sin((d - ring) * 30.0) * env;
      vec2 dir = normalize(uv - uPointer + 1e-4);
      vec2 disp = dir * wave * uIntensity * 0.25;
      uvC = uv + disp;
      uvN = uv + disp * 0.6;
      m = 1.0 - smoothstep(ring - 0.03, ring + 0.03, d);
    } else if (uMode == 2) {
      float slices = 14.0;
      float row = floor(uv.y * slices);
      float rnd = hash11(row);
      vec2 disp = vec2((rnd - 0.5) * env * uIntensity * 0.6, 0.0);
      uvC = uv + disp;
      uvN = uv + disp;
      float localX = uDir > 0.0 ? uv.x : 1.0 - uv.x;
      float th = p * 1.5 - 0.25 + (rnd - 0.5) * 0.25;
      m = 1.0 - smoothstep(th - 0.06, th + 0.06, localX);
    } else {
      float nn = fbm(uv * uScale + uTime * 0.03);
      float warp = fbm(uv * uScale * 1.7 - uTime * 0.02);
      vec2 g = vec2(nn, warp) - 0.5;
      uvC = uv + g * uIntensity * 0.5 * p;
      uvN = uv - g * uIntensity * 0.5 * (1.0 - p);
      m = smoothstep(nn - 0.15, nn + 0.15, p);
    }
  }

  vec2 sC = coverUV(uvC, uResolution, uCurrentSize);
  vec2 sN = coverUV(uvN, uResolution, uNextSize);

  float ca = uReduce < 0.5 ? uAberration * env * 0.03 : 0.0;

  vec3 colC = vec3(
    texture2D(tCurrent, sC + vec2(ca, 0.0)).r,
    texture2D(tCurrent, sC).g,
    texture2D(tCurrent, sC - vec2(ca, 0.0)).b
  );
  vec3 colN = vec3(
    texture2D(tNext, sN + vec2(ca, 0.0)).r,
    texture2D(tNext, sN).g,
    texture2D(tNext, sN - vec2(ca, 0.0)).b
  );

  vec3 col = mix(colC, colN, m);

  float vig = smoothstep(1.25, 0.25, length(uv - 0.5));
  col = mix(col, uOverlay, (1.0 - vig) * 0.28);

  gl_FragColor = vec4(col, 1.0);
}
`

function makeFallbackTexture(gl: GL): Texture {
  const size = 4
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 24
    data[i * 4 + 1] = 24
    data[i * 4 + 2] = 28
    data[i * 4 + 3] = 255
  }
  return new Texture(gl, { image: data, width: size, height: size, generateMipmaps: false })
}

function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || '#000000').replace('#', '')
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const n = parseInt(h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

interface EngineConfig {
  items: MorphItem[]
  startIndex: number
  reducedMotion: boolean
  getOptions: () => EngineOptions
  onIndexChange: (index: number) => void
  dprCap: number
  /** Хэшированное имя класса канваса: модуль стилей не виден движку */
  canvasClass: string
}

class MorphEngine {
  private container: HTMLElement
  private items: MorphItem[]
  private getOptions: () => EngineOptions
  private onIndexChange: (index: number) => void
  private reducedMotion: boolean

  private current: number
  private animating = false
  private dragging = false
  private dragDir = 0
  private shownIndex: number
  private tween: gsap.core.Tween | null = null

  private renderer: Renderer
  private gl: GL
  private canvas: HTMLCanvasElement
  private geometry: Triangle
  private program: Program
  private mesh: Mesh
  private textures: Texture[]
  private sizes: [number, number][]
  private resizeObserver: ResizeObserver
  private raf = 0
  private boundLoop: (t: number) => void
  private boundContextLost: (e: Event) => void

  constructor(container: HTMLElement, config: EngineConfig) {
    this.container = container
    this.items = config.items
    this.getOptions = config.getOptions
    this.onIndexChange = config.onIndexChange
    this.reducedMotion = config.reducedMotion
    this.current = config.startIndex
    this.shownIndex = config.startIndex

    this.renderer = new Renderer({
      alpha: false,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, config.dprCap),
    })
    this.gl = this.renderer.gl
    this.gl.clearColor(0.05, 0.05, 0.06, 1)

    this.canvas = this.gl.canvas as HTMLCanvasElement
    this.canvas.className = config.canvasClass
    container.appendChild(this.canvas)

    this.geometry = new Triangle(this.gl)

    this.textures = this.items.map(() => makeFallbackTexture(this.gl))
    this.sizes = this.items.map(() => [1, 1] as [number, number])

    const opts = this.getOptions()
    this.program = new Program(this.gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        tCurrent: { value: this.textures[this.current] },
        tNext: { value: this.textures[this.current] },
        uResolution: { value: [1, 1] },
        uCurrentSize: { value: this.sizes[this.current] },
        uNextSize: { value: this.sizes[this.current] },
        uProgress: { value: 0 },
        uDir: { value: 1 },
        uMode: { value: TRANSITIONS[opts.transition] ?? 0 },
        uIntensity: { value: opts.intensity },
        uScale: { value: opts.scale },
        uAberration: { value: opts.aberration },
        uDrift: { value: opts.drift },
        uTime: { value: 0 },
        uReduce: { value: this.reducedMotion ? 1 : 0 },
        uPointer: { value: [0.5, 0.5] },
        uOverlay: { value: hexToRgb(opts.overlayColor) },
      },
    })

    this.mesh = new Mesh(this.gl, { geometry: this.geometry, program: this.program })

    this.boundContextLost = this.onContextLost.bind(this)
    this.canvas.addEventListener('webglcontextlost', this.boundContextLost, false)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.loadTextures()

    this.boundLoop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.boundLoop)
  }

  private loadTextures(): void {
    this.items.forEach((item, index) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = item.image
      img.onload = () => {
        const texture = new Texture(this.gl, { generateMipmaps: false })
        texture.image = img
        this.textures[index] = texture
        this.sizes[index] = [img.naturalWidth || 1, img.naturalHeight || 1]
        if (index === this.current) {
          this.program.uniforms.tCurrent.value = texture
          this.program.uniforms.uCurrentSize.value = this.sizes[index]
        }
      }
      img.onerror = () => {}
    })
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect()
    const w = Math.max(rect.width, 1)
    const h = Math.max(rect.height, 1)
    this.renderer.setSize(w, h)
    this.program.uniforms.uResolution.value = [this.gl.canvas.width, this.gl.canvas.height]
  }

  private syncOptions(): void {
    const opts = this.getOptions()
    this.program.uniforms.uMode.value = TRANSITIONS[opts.transition] ?? 0
    this.program.uniforms.uIntensity.value = opts.intensity
    this.program.uniforms.uScale.value = opts.scale
    this.program.uniforms.uAberration.value = opts.aberration
    this.program.uniforms.uDrift.value = opts.drift
    this.program.uniforms.uOverlay.value = hexToRgb(opts.overlayColor)
  }

  private loop(t: number): void {
    this.program.uniforms.uTime.value = t * 0.001
    if (!this.dragging && !this.animating) this.syncOptions()
    this.renderer.render({ scene: this.mesh })
    this.raf = requestAnimationFrame(this.boundLoop)
  }

  private wrap(i: number): number {
    const n = this.items.length
    return ((i % n) + n) % n
  }

  /** Развести текущий и целевой кадр по юниформам и задать сторону морфа */
  private prepareTarget(target: number, dir: number): void {
    this.program.uniforms.tCurrent.value = this.textures[this.current]
    this.program.uniforms.uCurrentSize.value = this.sizes[this.current]
    this.program.uniforms.tNext.value = this.textures[target]
    this.program.uniforms.uNextSize.value = this.sizes[target]
    this.program.uniforms.uDir.value = dir
  }

  private prepareNext(dir: number): number {
    const target = this.wrap(this.current + dir)
    this.prepareTarget(target, dir)
    return target
  }

  /** Общий хвост перехода: и шаг стрелкой, и прыжок по точке кончаются здесь */
  private run(target: number): void {
    const opts = this.getOptions()
    this.animating = true
    this.announce(target)
    const duration = this.reducedMotion ? Math.min(opts.duration, 0.4) : opts.duration
    this.tween = gsap.fromTo(
      this.program.uniforms.uProgress,
      { value: 0 },
      {
        value: 1,
        duration,
        ease: opts.ease,
        onComplete: () => this.commit(target),
      },
    )
  }

  goTo(dir: number): void {
    if (this.animating || this.dragging || this.items.length < 2) return
    const opts = this.getOptions()
    if (!opts.loop) {
      const raw = this.current + dir
      if (raw < 0 || raw > this.items.length - 1) return
    }
    this.syncOptions()
    const target = this.prepareNext(dir)
    this.run(target)
  }

  /**
   * Переход к произвольному кадру.
   *
   * Этого в исходнике не было: клик по точке вызывал goTo(±1) и листал ровно на
   * один кадр, поэтому последняя точка уводила на вторую. Сторону морфа берём
   * по кратчайшей дуге — так переход идёт туда, куда ближе, и не отматывает
   * всю ленту ради соседа слева.
   */
  goToIndex(target: number): void {
    if (this.animating || this.dragging || this.items.length < 2) return
    const t = this.wrap(target)
    if (t === this.current) return
    const n = this.items.length
    const forward = this.wrap(t - this.current)
    const dir = this.getOptions().loop ? (forward * 2 <= n ? 1 : -1) : t > this.current ? 1 : -1
    this.syncOptions()
    this.prepareTarget(t, dir)
    this.run(t)
  }

  private announce(index: number): void {
    if (index === this.shownIndex) return
    this.shownIndex = index
    this.onIndexChange(index)
  }

  private commit(target: number): void {
    this.current = target
    this.program.uniforms.tCurrent.value = this.textures[target]
    this.program.uniforms.uCurrentSize.value = this.sizes[target]
    this.program.uniforms.uProgress.value = 0
    this.animating = false
    this.tween = null
    this.announce(target)
  }

  next(): void {
    this.goTo(1)
  }

  prev(): void {
    this.goTo(-1)
  }

  setPointer(x: number, y: number): void {
    this.program.uniforms.uPointer.value = [x, y]
  }

  beginDrag(): boolean {
    if (this.animating || this.items.length < 2) return false
    this.dragging = true
    this.dragDir = 0
    this.syncOptions()
    return true
  }

  drag(ndx: number): void {
    if (!this.dragging) return
    const opts = this.getOptions()
    const dir = ndx < 0 ? 1 : -1
    if (!opts.loop) {
      const raw = this.current + dir
      if (raw < 0 || raw > this.items.length - 1) {
        this.program.uniforms.uProgress.value = 0
        return
      }
    }
    if (dir !== this.dragDir) {
      this.dragDir = dir
      this.prepareNext(dir)
    }
    const progress = Math.min(Math.abs(ndx), 1)
    this.program.uniforms.uProgress.value = progress
    this.announce(progress > 0.5 ? this.wrap(this.current + dir) : this.current)
  }

  endDrag(): void {
    if (!this.dragging) return
    this.dragging = false
    const p = this.program.uniforms.uProgress.value as number
    if (this.dragDir === 0) return
    const target = this.wrap(this.current + this.dragDir)
    const duration = this.reducedMotion ? 0.3 : 0.5
    this.animating = true
    if (p > 0.4) {
      this.announce(target)
      this.tween = gsap.to(this.program.uniforms.uProgress, {
        value: 1,
        duration,
        ease: 'power2.out',
        onComplete: () => this.commit(target),
      })
    } else {
      this.announce(this.current)
      this.tween = gsap.to(this.program.uniforms.uProgress, {
        value: 0,
        duration,
        ease: 'power2.out',
        onComplete: () => {
          this.animating = false
          this.tween = null
        },
      })
    }
  }

  private onContextLost(e: Event): void {
    e.preventDefault()
    cancelAnimationFrame(this.raf)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    if (this.tween) this.tween.kill()
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.boundContextLost)
    this.textures.forEach((tex) => {
      if (tex && tex.texture) this.gl.deleteTexture(tex.texture)
    })
    if (this.program && this.program.program) this.gl.deleteProgram(this.program.program)
    const ext = this.gl.getExtension('WEBGL_lose_context')
    if (ext) ext.loseContext()
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas)
  }
}

export default function MorphSlider({
  items,
  startIndex = 0,
  transition = 'melt',
  duration = 1.1,
  ease = 'power2.inOut',
  intensity = 0.55,
  scale = 2.4,
  aberration = 0.35,
  drift = 0.4,
  autoplay = false,
  autoplayDelay = 4,
  loop = true,
  radius = 16,
  overlayColor = '#000000',
  showCaptions = true,
  showControls = true,
  showIndicators = true,
  className = '',
  label = 'Слайдер',
  onChange,
  onActivate,
}: MorphSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<MorphEngine | null>(null)
  const [index, setIndex] = useState(startIndex)
  const [hovering, setHovering] = useState(false)

  // Настройки и колбэки живут в ref: эффекты движка и указателя ставятся один
  // раз, и новый объект пропсов не должен их пересоздавать.
  const onChangeRef = useRef(onChange)
  const onActivateRef = useRef(onActivate)
  const optsRef = useRef<EngineOptions>({
    transition,
    duration,
    ease,
    intensity,
    scale,
    aberration,
    drift,
    overlayColor,
    loop,
  })

  /*
   * В исходнике ref'ы переписывались прямо в теле компонента. Здесь так нельзя:
   * правило react-hooks/refs у проекта включено как ошибка, и по делу — запись
   * во время рендера ломает конкурентный рендер, где тело могут выполнить и
   * выбросить. Эффект без списка зависимостей делает то же самое, только после
   * коммита: движок читает эти значения из RAF-цикла и из обработчиков
   * указателя, и кадр задержки для них ничего не значит.
   */
  useEffect(() => {
    onChangeRef.current = onChange
    onActivateRef.current = onActivate
    optsRef.current = {
      transition,
      duration,
      ease,
      intensity,
      scale,
      aberration,
      drift,
      overlayColor,
      loop,
    }
  })

  useEffect(() => {
    if (!containerRef.current) return undefined
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const engine = new MorphEngine(containerRef.current, {
      items,
      startIndex,
      reducedMotion,
      dprCap: 2,
      canvasClass: styles.canvas,
      getOptions: () => optsRef.current,
      onIndexChange: (i) => {
        setIndex(i)
        onChangeRef.current?.(i)
      },
    })
    engineRef.current = engine
    setIndex(startIndex)

    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [items, startIndex])

  const handleNext = useCallback(() => engineRef.current?.next(), [])
  const handlePrev = useCallback(() => engineRef.current?.prev(), [])

  useEffect(() => {
    if (!autoplay || hovering) return undefined
    const id = window.setTimeout(
      () => engineRef.current?.next(),
      Math.max(autoplayDelay, 1) * 1000,
    )
    return () => window.clearTimeout(id)
  }, [autoplay, autoplayDelay, hovering, index])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    let startX = 0
    let startY = 0
    let downAt = 0
    let width = 1
    let pressed = false
    let moved = false
    let active = false

    const onDown = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      width = rect.width || 1
      startX = e.clientX
      startY = e.clientY
      downAt = e.timeStamp
      pressed = true
      moved = false
      const px = (e.clientX - rect.left) / rect.width
      const py = (e.clientY - rect.top) / rect.height
      engineRef.current?.setPointer(px, 1 - py)
      // Протяжку движок может не принять (например, идёт автоплей), но
      // нажатие всё равно нужно дослушать: из него ещё может выйти клик.
      active = engineRef.current?.beginDrag() ?? false
      if (el.setPointerCapture) {
        try {
          el.setPointerCapture(e.pointerId)
        } catch {}
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!pressed) return
      if (Math.abs(e.clientX - startX) > TAP_SLOP || Math.abs(e.clientY - startY) > TAP_SLOP) {
        moved = true
      }
      if (!active) return
      engineRef.current?.drag((e.clientX - startX) / width)
    }
    const onUp = (e: PointerEvent) => {
      if (!pressed) return
      pressed = false
      const tap = !moved && e.timeStamp - downAt < TAP_MS
      if (active) {
        active = false
        engineRef.current?.endDrag()
      }
      if (tap) onActivateRef.current?.()
    }
    const onCancel = () => {
      if (!pressed) return
      pressed = false
      if (active) {
        active = false
        engineRef.current?.endDrag()
      }
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
    }
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      } else if (onActivateRef.current && (e.key === 'Enter' || e.key === ' ')) {
        // клавиатурный эквивалент клика по кадру — иначе лайтбокс доступен
        // только мышью, а фокус на сцену мы уже отдаём
        e.preventDefault()
        onActivateRef.current()
      }
    },
    [handleNext, handlePrev],
  )

  const hasCaptions = items.some((item) => item.caption)

  return (
    <div
      className={`${styles.slider} ${className}`.trim()}
      style={
        {
          borderRadius: `${radius}px`,
          '--ms-swap': `${(duration * 0.66).toFixed(3)}s`,
          '--ms-dot': `${(duration * 0.45).toFixed(3)}s`,
        } as CSSProperties
      }
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        ref={containerRef}
        className={styles.stage}
        role="group"
        aria-roledescription="карусель"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
      />

      {showCaptions && hasCaptions && (
        <div className={styles.caption} aria-live="polite">
          {items.map((item, i) =>
            item.caption ? (
              <span
                key={i}
                aria-hidden={i === index ? undefined : true}
                className={`${styles.captionText} ${i === index ? styles.isActive : ''}`}
              >
                {item.caption}
              </span>
            ) : null,
          )}
        </div>
      )}

      {showControls && (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.btn}
            aria-label="Предыдущий кадр"
            onClick={handlePrev}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className={styles.btn}
            aria-label="Следующий кадр"
            onClick={handleNext}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M9 5l7 7-7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}

      {showIndicators && (
        <div className={styles.indicators} role="tablist" aria-label="Кадры">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Кадр ${i + 1} из ${items.length}`}
              className={`${styles.dot} ${i === index ? styles.isActive : ''}`}
              onClick={() => engineRef.current?.goToIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
