/**
 * PixelSnow — источник: React Bits (reactbits.dev/backgrounds/pixel-snow, MIT).
 * Шейдер скопирован как есть; вся настройка снаружи, в components/SeasonalSnow.
 *
 * НА OGL, А НЕ НА THREE. Оригинал рисовал один полноэкранный квад через
 * three: WebGLRenderer, Scene, камеру и ShaderMaterial — ленивый чанк на
 * 528 КБ без сжатия ради одного фрагментного шейдера. ogl в проекте уже есть
 * (слайдер кадров, components/morph), и тот же кадр он рисует треугольником на
 * весь экран за десятки килобайт; three ушёл из зависимостей.
 *
 * Шейдер — GLSL ES 3.0: хэш на uint и битовых сдвигах в WebGL1 не собрать.
 * three молча дописывал `#version 300 es`, `precision highp int` и выход
 * вместо gl_FragColor — здесь это сделано явно (FRAGMENT ниже), а без WebGL2
 * снега просто нет.
 *
 * Подключается ТОЛЬКО через next/dynamic и ТОЛЬКО в декабре. Снег — холодная
 * зимняя метафора, а палитра у нас тёплая; в декабре это оправдано, круглый
 * год — нет.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Mesh, Program, Renderer, Triangle } from 'ogl';

const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision mediump float;

uniform float uTime;
uniform vec2 uResolution;
uniform float uFlakeSize;
uniform float uMinFlakeSize;
uniform float uPixelResolution;
uniform float uSpeed;
uniform float uDepthFade;
uniform float uFarPlane;
uniform vec3 uColor;
uniform float uBrightness;
uniform float uGamma;
uniform float uDensity;
uniform float uVariant;
uniform float uDirection;

// Precomputed constants
#define PI 3.14159265
#define PI_OVER_6 0.5235988
#define PI_OVER_3 1.0471976
#define INV_SQRT3 0.57735027
#define M1 1597334677U
#define M2 3812015801U
#define M3 3299493293U
#define F0 2.3283064e-10

// Optimized hash - inline multiplication
#define hash(n) (n * (n ^ (n >> 15)))
#define coord3(p) (uvec3(p).x * M1 ^ uvec3(p).y * M2 ^ uvec3(p).z * M3)

// Precomputed camera basis vectors (normalized vec3(1,1,1), vec3(1,0,-1))
const vec3 camK = vec3(0.57735027, 0.57735027, 0.57735027);
const vec3 camI = vec3(0.70710678, 0.0, -0.70710678);
const vec3 camJ = vec3(-0.40824829, 0.81649658, -0.40824829);

// Precomputed branch direction
const vec2 b1d = vec2(0.574, 0.819);

vec3 hash3(uint n) {
  uvec3 hashed = hash(n) * uvec3(1U, 511U, 262143U);
  return vec3(hashed) * F0;
}

float snowflakeDist(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  a = abs(mod(a + PI_OVER_6, PI_OVER_3) - PI_OVER_6);
  vec2 q = r * vec2(cos(a), sin(a));
  float dMain = max(abs(q.y), max(-q.x, q.x - 1.0));
  float b1t = clamp(dot(q - vec2(0.4, 0.0), b1d), 0.0, 0.4);
  float dB1 = length(q - vec2(0.4, 0.0) - b1t * b1d);
  float b2t = clamp(dot(q - vec2(0.7, 0.0), b1d), 0.0, 0.25);
  float dB2 = length(q - vec2(0.7, 0.0) - b2t * b1d);
  return min(dMain, min(dB1, dB2)) * 10.0;
}

void main() {
  // Precompute reciprocals to avoid division
  float invPixelRes = 1.0 / uPixelResolution;
  float pixelSize = max(1.0, floor(0.5 + uResolution.x * invPixelRes));
  float invPixelSize = 1.0 / pixelSize;
  
  vec2 fragCoord = floor(gl_FragCoord.xy * invPixelSize);
  vec2 res = uResolution * invPixelSize;
  float invResX = 1.0 / res.x;

  vec3 ray = normalize(vec3((fragCoord - res * 0.5) * invResX, 1.0));
  ray = ray.x * camI + ray.y * camJ + ray.z * camK;

  // Precompute time-based values
  float timeSpeed = uTime * uSpeed;
  float windX = cos(uDirection) * 0.4;
  float windY = sin(uDirection) * 0.4;
  vec3 camPos = (windX * camI + windY * camJ + 0.1 * camK) * timeSpeed;
  vec3 pos = camPos;

  // Precompute ray reciprocal for strides
  vec3 absRay = max(abs(ray), vec3(0.001));
  vec3 strides = 1.0 / absRay;
  vec3 raySign = step(ray, vec3(0.0));
  vec3 phase = fract(pos) * strides;
  phase = mix(strides - phase, phase, raySign);

  // Precompute for intersection test
  float rayDotCamK = dot(ray, camK);
  float invRayDotCamK = 1.0 / rayDotCamK;
  float invDepthFade = 1.0 / uDepthFade;
  float halfInvResX = 0.5 * invResX;
  vec3 timeAnim = timeSpeed * 0.1 * vec3(7.0, 8.0, 5.0);

  float t = 0.0;
  for (int i = 0; i < 128; i++) {
    if (t >= uFarPlane) break;
    
    vec3 fpos = floor(pos);
    uint cellCoord = coord3(fpos);
    float cellHash = hash3(cellCoord).x;

    if (cellHash < uDensity) {
      vec3 h = hash3(cellCoord);
      
      // Optimized flake position calculation
      vec3 sinArg1 = fpos.yzx * 0.073;
      vec3 sinArg2 = fpos.zxy * 0.27;
      vec3 flakePos = 0.5 - 0.5 * cos(4.0 * sin(sinArg1) + 4.0 * sin(sinArg2) + 2.0 * h + timeAnim);
      flakePos = flakePos * 0.8 + 0.1 + fpos;

      float toIntersection = dot(flakePos - pos, camK) * invRayDotCamK;
      
      if (toIntersection > 0.0) {
        vec3 testPos = pos + ray * toIntersection - flakePos;
        float testX = dot(testPos, camI);
        float testY = dot(testPos, camJ);
        vec2 testUV = abs(vec2(testX, testY));
        
        float depth = dot(flakePos - camPos, camK);
        float flakeSize = max(uFlakeSize, uMinFlakeSize * depth * halfInvResX);
        
        // Avoid branching with step functions where possible
        float dist;
        if (uVariant < 0.5) {
          dist = max(testUV.x, testUV.y);
        } else if (uVariant < 1.5) {
          dist = length(testUV);
        } else {
          float invFlakeSize = 1.0 / flakeSize;
          dist = snowflakeDist(vec2(testX, testY) * invFlakeSize) * flakeSize;
        }

        if (dist < flakeSize) {
          float flakeSizeRatio = uFlakeSize / flakeSize;
          float intensity = exp2(-(t + toIntersection) * invDepthFade) *
                           min(1.0, flakeSizeRatio * flakeSizeRatio) * uBrightness;
          gl_FragColor = vec4(uColor * pow(vec3(intensity), vec3(uGamma)), 1.0);
          return;
        }
      }
    }

    float nextStep = min(min(phase.x, phase.y), phase.z);
    vec3 sel = step(phase, vec3(nextStep));
    phase = phase - nextStep + strides * sel;
    t += nextStep;
    pos = mix(pos + ray * nextStep, floor(pos + ray * nextStep + 0.5), sel);
  }

  gl_FragColor = vec4(0.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
${fragmentShader.replace(/gl_FragColor/g, 'fragColor')}`;

/** '#fff' и '#ffffff' → [r, g, b] в 0..1; всё прочее — белый */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255) as [number, number, number];
}

interface PixelSnowProps {
  color?: string;
  flakeSize?: number;
  minFlakeSize?: number;
  pixelResolution?: number;
  speed?: number;
  depthFade?: number;
  farPlane?: number;
  brightness?: number;
  gamma?: number;
  density?: number;
  variant?: 'square' | 'round' | 'snowflake';
  direction?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function PixelSnow({
  color = '#ffffff',
  flakeSize = 0.01,
  minFlakeSize = 1.25,
  pixelResolution = 200,
  speed = 1.25,
  depthFade = 8,
  farPlane = 20,
  brightness = 1,
  gamma = 0.4545,
  density = 0.3,
  variant = 'square',
  direction = 125,
  className = '',
  style = {}
}: PixelSnowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const isVisibleRef = useRef(true);
  const rendererRef = useRef<Renderer | null>(null);
  const programRef = useRef<Program | null>(null);
  const resizeTimeoutRef = useRef<number | null>(null);

  // Memoize shader variant value
  const variantValue = useMemo(() => {
    return variant === 'round' ? 1.0 : variant === 'snowflake' ? 2.0 : 0.0;
  }, [variant]);

  // Memoize color conversion
  const colorVector = useMemo(() => hexToRgb(color), [color]);

  // Debounced resize handler
  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = window.setTimeout(() => {
      const container = containerRef.current;
      const renderer = rendererRef.current;
      const program = programRef.current;
      if (!container || !renderer || !program) return;

      const w = container.offsetWidth;
      const h = container.offsetHeight;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value = [w, h];
    }, 100);
  }, []);

  // Visibility observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
      },
      { threshold: 0 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Сцена — один раз: треугольник на весь экран и программа с шейдером
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Без WebGL вовсе конструктор ogl падает (gl = null) — а снег декоративен,
    // и ронять из-за него «Игру дня» в экран ошибки нельзя
    let renderer: Renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
        dpr: Math.min(window.devicePixelRatio, 2)
      });
    } catch {
      return;
    }
    const gl = renderer.gl;
    // Шейдер на uint — только GLSL ES 3.0; без WebGL2 снега нет, страница та же
    if (!renderer.isWebgl2) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return;
    }
    gl.clearColor(0, 0, 0, 0);
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    container.appendChild(gl.canvas);
    rendererRef.current = renderer;

    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        // CSS-пиксели, как в оригинале: шейдер сам делит gl_FragCoord на размер «пикселя»
        uResolution: { value: [container.offsetWidth, container.offsetHeight] },
        uFlakeSize: { value: flakeSize },
        uMinFlakeSize: { value: minFlakeSize },
        uPixelResolution: { value: pixelResolution },
        uSpeed: { value: speed },
        uDepthFade: { value: depthFade },
        uFarPlane: { value: farPlane },
        uColor: { value: [...colorVector] },
        uBrightness: { value: brightness },
        uGamma: { value: gamma },
        uDensity: { value: density },
        uVariant: { value: variantValue },
        uDirection: { value: (direction * Math.PI) / 180 }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    programRef.current = program;

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    window.addEventListener('resize', handleResize);

    const startTime = performance.now();
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);

      // Only render if visible
      if (isVisibleRef.current) {
        program.uniforms.uTime.value = (performance.now() - startTime) * 0.001;
        renderer.render({ scene: mesh });
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (container.contains(gl.canvas)) {
        container.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      rendererRef.current = null;
      programRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- сцена одна на жизнь компонента; пропсы доезжают эффектом ниже
  }, [handleResize]);

  // Пропсы — в униформы программы
  useEffect(() => {
    const program = programRef.current;
    if (!program) return;

    program.uniforms.uFlakeSize.value = flakeSize;
    program.uniforms.uMinFlakeSize.value = minFlakeSize;
    program.uniforms.uPixelResolution.value = pixelResolution;
    program.uniforms.uSpeed.value = speed;
    program.uniforms.uDepthFade.value = depthFade;
    program.uniforms.uFarPlane.value = farPlane;
    program.uniforms.uBrightness.value = brightness;
    program.uniforms.uGamma.value = gamma;
    program.uniforms.uDensity.value = density;
    program.uniforms.uVariant.value = variantValue;
    program.uniforms.uDirection.value = (direction * Math.PI) / 180;
    program.uniforms.uColor.value = [...colorVector];
  }, [
    flakeSize,
    minFlakeSize,
    pixelResolution,
    speed,
    depthFade,
    farPlane,
    brightness,
    gamma,
    density,
    variantValue,
    direction,
    colorVector
  ]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 w-full h-full transform-gpu will-change-transform backface-hidden ${className}`}
      style={style}
    />
  );
}

