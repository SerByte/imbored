'use client'

import { useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HeroArt } from '@/components/HeroArt'
import { lazyIsland } from '@/components/lazyIsland'
import { webglAvailable } from '@/components/morph/gl'
import type { GameArtUrls } from '@/lib/art'
import { HERO_SLIDES, pickCoverShotSize, shotUrl, type ShotSize } from '@/lib/shots'

/*
 * Слайдер с ogl — отдельным чанком и только в браузере. Островком
 * (components/lazyIsland), а не next/dynamic: герой стоит на /play и /daily,
 * у потолка бюджета первой загрузки (bundle-budget.json), а рантайм
 * next/dynamic добавлял им ~4 КБ. Не пришёл чанк — герой остаётся артом, как
 * и при любом другом сбое морфа (докблок ниже).
 */
const MorphSlider = lazyIsland(() => import('@/components/morph/MorphSlider').then((m) => m.default))

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
  anchor = null,
}: {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
  screenshots: string[]
  /** Своя игра-ориентир — фон у игры не из Steam (см. HeroArt) */
  anchor?: { appid: number; name: string } | null
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

  useParallax(reduced !== true)

  return (
    <>
      <HeroArt appid={appid} headerImage={headerImage} art={art} name={name} anchor={anchor} />
      {enabled && <HeroMorph shots={shots} name={name} />}
    </>
  )
}

/** Предел сдвига фона за курсором, px: по горизонтали и по вертикали */
const PARALLAX_X = 12
const PARALLAX_Y = 8

/**
 * ПАРАЛЛАКС ФОНА ЗА КУРСОРОМ.
 *
 * Слои героя с классом .hero-layer (арт, морф, фоновый трейлер) чуть
 * отъезжают против курсора — фон «глубже» текста, и экран перестаёт быть
 * плоской картинкой. Сдвиг — CSS-свойство translate, отдельное от transform:
 * у арта transform занят кен-бёрнсом, и они складываются, а не перебивают друг
 * друга. Запас по краям даёт scale в той же таблице.
 *
 * Только мышь (pointer: fine) и только без «уменьшить движение». Пишем прямо
 * в style слоёв раз в кадр, а не в переменную на корне: переменная на <html>
 * пересчитывала бы стили всей страницы на каждое движение мыши. Слои ищутся
 * на каждом кадре, потому что трейлер и морф монтируются позже героя.
 */
function useParallax(on: boolean) {
  useEffect(() => {
    if (!on || !window.matchMedia('(pointer: fine)').matches) return
    let raf = 0
    let x = 0
    let y = 0
    const paint = () => {
      raf = 0
      const value = `${(-x * PARALLAX_X).toFixed(1)}px ${(-y * PARALLAX_Y).toFixed(1)}px`
      for (const el of document.querySelectorAll<HTMLElement>('.hero-layer')) el.style.translate = value
    }
    const move = (e: PointerEvent) => {
      x = (e.clientX / window.innerWidth) * 2 - 1
      y = (e.clientY / window.innerHeight) * 2 - 1
      if (!raf) raf = requestAnimationFrame(paint)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [on])
}

function HeroMorph({ shots, name }: { shots: string[]; name: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [env, setEnv] = useState<Env | null>(null)
  const [visible, setVisible] = useState(false)
  /** Первый кадр скачан — слайдер можно проявлять */
  const [ready, setReady] = useState(false)
  /** Скачаны все кадры — можно и перетечь, не уходя в серую заглушку движка */
  const [armed, setArmed] = useState(false)
  /**
   * Сколько раз сменился кадр. Один переход — и морф встаёт.
   *
   * Фон под заголовком /play и /daily листался раз в семь секунд бесконечно,
   * а остановить его было нечем: слайдер здесь inert, без кнопок, и держит
   * его только prefers-reduced-motion. Движение дольше пяти секунд без
   * механизма паузы — провал WCAG 2.2.2 (Pause, Stop, Hide, уровень A), и
   * кнопка «Пауза» на фоне — лишний элемент в самом загруженном месте
   * экрана.
   *
   * Сначала это решал «один круг», но круг из трёх кадров по семь секунд с
   * таянием по 2.2 — это переходы на 7-й, 16-й и 25-й секунде, около 27 с
   * самоходного фона: та же граница, только дальше. Теперь переход один и
   * укладывается в AUTO_MOTION (lib/motion.ts) от того кадра, когда морф
   * проявился: секунда покоя и 2.2 с таяния. Игра показана в движении, а
   * дальше под текстом лежит неподвижная картинка. Сторож — lib/motion.test.ts.
   */
  const [turns, setTurns] = useState(0)

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

  /*
   * Автоплей ждёт, пока герой на экране: уехавший герой не тратит свой
   * единственный переход впустую. Кадры движок перестаёт рисовать сам, как
   * только ничего не движется, — этот наблюдатель держит только автоплей.
   */
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
   * Кадры тянем сами и проявляем слайдер только после загрузки первого.
   *
   * Стартовая текстура движка — серый квадрат 4×4, поэтому голое монтирование
   * дало бы серую заливку на весь экран вместо арта на всё время закачки
   * трёхсоткилобайтного кадра. Обёртка при этом монтируется сразу, чтобы чанк
   * с ogl и сами картинки ехали параллельно, а не по очереди.
   *
   * Переход ждёт ВСЕ кадры (armed). Пока пауза перед ним была семь секунд,
   * второй кадр успевал доехать сам; при секундной на медленной сети морф
   * перетёк бы в ту же серую заглушку — и единственный переход героя был бы
   * в серое. Не доехал второй кадр — переход не случится вовсе, герой
   * останется первым кадром.
   *
   * crossOrigin обязателен и должен совпадать с тем, как грузит движок: иначе
   * запрос уйдёт в другом режиме CORS и кадр скачается дважды. Заодно onerror
   * закрывает чужие CDN без нужных заголовков — там слайдер просто не всплывёт.
   */
  useEffect(() => {
    if (!items.length) return
    let alive = true
    let left = items.length
    items.forEach((item, i) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (!alive) return
        if (i === 0) setReady(true)
        left -= 1
        if (left === 0) setArmed(true)
      }
      img.src = item.image
    })
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
      className={`hero-layer absolute inset-0 transition-opacity duration-700 ${
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
          autoplay={visible && armed && turns < 1}
          onChange={() => setTurns((t) => t + 1)}
          /* Секунда — меньше слайдер не даёт; она нужна, чтобы первый кадр
             успел проявиться (700 мс) и побыть, прежде чем потечь */
          autoplayDelay={1}
          loop
          /* под зерном, блюр-полосой и скримом разница в плотности не читается,
             а пикселей для тяжёлого шума в шейдере кратно меньше */
          dprCap={1.5}
          radius={0}
          /* виньетка подмешивает этот цвет по краям: фон секции, а не чёрный,
             иначе по периметру читается кольцо */
          overlayColor="#050505"
          showCaptions={false}
          showControls={false}
          showIndicators={false}
          label={`Кадры из игры ${name}`}
        />
      )}
    </div>
  )
}
