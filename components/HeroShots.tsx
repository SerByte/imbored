'use client'

import { useReducedMotion } from 'motion/react'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HeroArt } from '@/components/HeroArt'
import { webglAvailable } from '@/components/morph/gl'
import type { GameArtUrls } from '@/lib/art'
import { pickCoverShotSize, shotUrl, type ShotSize } from '@/lib/shots'

const MorphSlider = dynamic(() => import('@/components/morph/MorphSlider'), { ssr: false })

/**
 * Сколько кадров крутит герой.
 *
 * Меньше, чем на странице игры: тут кадры обязательно полноразмерные (герой во
 * весь экран, маленькие мылят), а движок держит все текстуры распакованными —
 * четыре по 1920×1080 это уже около 33 МБ видеопамяти. Полный круг при таком
 * темпе занимает больше половины минуты, а столько на заставку не смотрят.
 */
const HERO_SLIDES = 4

/** Что удалось выяснить про среду; до первого замера — null */
type Env = { gl: boolean; size: ShotSize }

/**
 * Герой «Игры дня»: арт, который перетекает по кадрам самой игры.
 *
 * Возвращает фрагмент, а не обёртку, и это принципиально. Слои на странице
 * держатся строго порядком разметки, без z-index, поэтому HeroArt обязан
 * остаться первым ребёнком секции, а морф встать сразу за ним и перед скримом.
 * Обёртка добавила бы лишний уровень и сломала бы этот порядок.
 *
 * Арт из разметки не убирается совсем: он виден, пока идёт проба контекста,
 * качается чанк и декодируется первый кадр, и он же остаётся, если что-то из
 * этого не сложилось. По той же причине с него не снимается anim-kenburns —
 * решение о морфе приходит позже первого кадра, и снятие класса читалось бы
 * как рывок.
 */
export function HeroShots({
  appid,
  name,
  headerImage,
  art,
  screenshots,
}: {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
  screenshots: string[]
}) {
  const reduced = useReducedMotion()
  const shots = useMemo(() => screenshots.slice(0, HERO_SLIDES), [screenshots])

  /*
   * Порог в два кадра, а не в один: на одном движок листает вхолостую, и
   * получился бы канвас с неподвижной картинкой — строго хуже обычного <img>.
   *
   * При prefers-reduced-motion морф не приглушается, а не появляется вовсе.
   * Здесь он декоративен и неинтерактивен, так что «выключить автоплей»
   * оставило бы ровно тот же мёртвый канвас. Решение то же, что у снега на
   * этой же странице: выключаем целиком, а не замедляем.
   *
   * useReducedMotion возвращает boolean | null, поэтому сравнение явное.
   */
  const enabled = reduced !== true && shots.length >= 2

  return (
    <>
      <HeroArt appid={appid} headerImage={headerImage} art={art} name={name} />
      {enabled && <HeroMorph shots={shots} name={name} />}
    </>
  )
}

function HeroMorph({ shots, name }: { shots: string[]; name: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [env, setEnv] = useState<Env | null>(null)
  const [visible, setVisible] = useState(false)
  const [ready, setReady] = useState(false)

  /*
   * Замер одноразовый: наблюдатель снимает размер и тут же отключается.
   *
   * Причина конкретная. Движок слайдера пересоздаётся при смене items, а items
   * зависят от выбранного размера кадра. Оставь мы наблюдатель живым — поворот
   * телефона пересобрал бы движок, и вместо героя на мгновение появился бы
   * чёрный экран с перезагрузкой всех текстур. Кадр, выбранный под стартовую
   * геометрию, переживает поворот заметно достойнее.
   *
   * Состояние ставится из колбэка подписки, а не из тела эффекта — иначе
   * правило react-hooks/set-state-in-effect (у проекта это ошибка, не совет).
   */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) return
      ro.disconnect()
      setEnv({
        gl: webglAvailable(),
        size: pickCoverShotSize(width, height, window.devicePixelRatio || 1),
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Автоплей крутится, только пока герой на экране: ушёл — RAF засыпает */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // без контекста ни размер, ни кадры не нужны — герой останется артом
  const size = env?.gl ? env.size : undefined
  const items = useMemo(
    () => (size ? shots.map((src) => ({ image: shotUrl(src, size) })) : []),
    [shots, size],
  )

  /*
   * Первый кадр тянем сами и только после его загрузки проявляем слайдер.
   *
   * Стартовая текстура движка — серый квадрат 4×4, поэтому голое монтирование
   * дало бы серую заливку на весь экран вместо арта на всё время закачки
   * трёхсоткилобайтного кадра. Обёртка при этом монтируется сразу, чтобы чанк
   * с ogl и сама картинка ехали параллельно, а не по очереди.
   *
   * crossOrigin обязателен и должен совпадать с тем, как грузит движок: иначе
   * запрос уйдёт в другом режиме CORS и кадр скачается дважды. Заодно onerror
   * закрывает чужие CDN без нужных заголовков — там слайдер просто не всплывёт.
   */
  useEffect(() => {
    const first = items[0]?.image
    if (!first) return
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (alive) setReady(true)
    }
    img.src = first
    return () => {
      alive = false
    }
  }, [items])

  return (
    <div
      ref={wrapRef}
      aria-hidden
      /* inert, а не только pointer-events: у сцены слайдера захардкожен
         tabIndex, и фон иначе стал бы бессмысленной остановкой табуляции —
         а aria-hidden вокруг фокусируемого элемента ещё и нарушение. */
      inert
      className={`absolute inset-0 transition-opacity duration-700 ${
        ready ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {items.length > 0 && (
        <MorphSlider
          items={items}
          /* Тише, чем на странице игры, и намеренно: там кадр рассматривают, а
             здесь под ним лежит название игры — главный текст страницы.
             Аберрация почти в ноль (цветная кайма под белым заголовком бьёт по
             читаемости первой), дрейф в ноль (кен-бёрнс у арта уже есть, а фон
             под текстом лучше неподвижен). */
          transition="melt"
          duration={2.2}
          ease="power1.inOut"
          intensity={0.3}
          scale={3}
          aberration={0.1}
          drift={0}
          autoplay={visible}
          autoplayDelay={7}
          loop
          /* под зерном, блюр-полосой и скримом разница в плотности не читается,
             а пикселей для тяжёлого шума в шейдере кратно меньше */
          dprCap={1.5}
          radius={0}
          /* виньетка подмешивает этот цвет по краям: фон секции, а не чёрный,
             иначе по периметру читается кольцо */
          overlayColor="#0b0c10"
          showCaptions={false}
          showControls={false}
          showIndicators={false}
          label={`Кадры из игры ${name}`}
        />
      )}
    </div>
  )
}
