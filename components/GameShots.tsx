'use client'

import { useReducedMotion } from 'motion/react'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Lightbox } from '@/components/Lightbox'
import { webglAvailable } from '@/components/morph/gl'
import { Screenshots } from '@/components/Screenshots'
import { pickShotSize, shotUrl, type ShotSize } from '@/lib/shots'

/**
 * Блок «Скриншоты» на странице игры: кадры перетекают друг в друга.
 *
 * Островок клиентский, и обязан им быть: `ssr: false` у next/dynamic в
 * серверных компонентах запрещён, а рендерить WebGL на сервере всё равно
 * нечего. Сама страница игры остаётся серверной.
 *
 * Порядок появления кадра выстроен так, чтобы ничего не прыгало:
 *
 * 1. С сервера приезжает обычный <img> первого кадра в боксе 16:9. Он же
 *    работает, когда скрипты выключены.
 * 2. На клиенте меряем ширину и проверяем контекст.
 * 3. Слайдер монтируется поверх, в том же боксе и с тем же первым кадром —
 *    сдвига макета нет, а текстура берётся из кеша браузера.
 * 4. Контекста нет — вместо бокса показываем прежнюю сетку миниатюр.
 *
 * Слайдер уезжает в отдельный чанк вместе с ogl и подгружается, только когда
 * блок подходит к экрану: на странице игры он лежит ниже описания и патчнотов,
 * и до него доскроллит не каждый.
 */
const MorphSlider = dynamic(() => import('@/components/morph/MorphSlider'), { ssr: false })

/**
 * Сколько кадров отдаём слайдеру.
 *
 * Движок грузит все текстуры сразу и держит их распакованными: шесть кадров
 * 1920×1080 — это уже около 50 МБ видеопамяти. У иных игр в базе лежит по два
 * десятка скриншотов, и показать их все значило бы уронить вкладку на
 * встройке. Шесть — столько же, сколько показывала сетка до слайдера.
 */
const SLIDES = 6

/** Что удалось выяснить про среду; до первого замера — null */
type Env = { gl: boolean; size: ShotSize }

export function GameShots({ images, name }: { images: string[]; name: string }) {
  const shots = useMemo(() => images.slice(0, SLIDES), [images])
  const wrapRef = useRef<HTMLDivElement>(null)

  // null — ещё не мерили: до монтирования разметка обязана совпасть с серверной
  const [env, setEnv] = useState<Env | null>(null)
  const [near, setNear] = useState(false)
  const [visible, setVisible] = useState(false)
  const [current, setCurrent] = useState(0)
  const [open, setOpen] = useState<number | null>(null)

  const reduced = useReducedMotion()

  /*
   * Среда выясняется в колбэке наблюдателя, а не в теле эффекта: правило
   * react-hooks/set-state-in-effect у проекта включено как ошибка, и подписка
   * — ровно тот случай, который оно разрешает.
   *
   * ResizeObserver здесь не формальность: первый вызов приходит сразу с
   * реальной шириной, а следующие ловят поворот телефона и перетаскивание окна
   * через порог размера. Объект пересобирается, только когда что-то поменялось,
   * иначе React перерисовывал бы блок на каждый кадр ресайза.
   */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const gl = webglAvailable()
      const size = pickShotSize(entry.contentRect.width, window.devicePixelRatio || 1)
      setEnv((prev) => (prev && prev.gl === gl && prev.size === size ? prev : { gl, size }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Два наблюдателя с разными полями: один решает, когда тянуть чанк и текстуры,
  // второй — крутить ли автоплей. Слить их в один нельзя, у них разный запас.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const soon = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setNear(true)
        soon.disconnect()
      },
      { rootMargin: '300px' },
    )
    const onScreen = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    soon.observe(el)
    onScreen.observe(el)
    return () => {
      soon.disconnect()
      onScreen.disconnect()
    }
  }, [])

  /**
   * Кадры для слайдера — в размере под фактическую ширину блока.
   * Подписей нет: у скриншотов Steam нет заголовков, а «3 из 6» уже сказано
   * точками внизу.
   */
  const size = env?.size
  const items = useMemo(
    () => (size ? shots.map((src) => ({ image: shotUrl(src, size) })) : []),
    [shots, size],
  )

  // Лайтбокс всегда открывает полный кадр: там его и рассматривают
  const fullShots = useMemo(() => shots.map((src) => shotUrl(src, 'full')), [shots])

  if (env && !env.gl) return <Screenshots images={fullShots} name={name} />

  const ready = env?.gl === true && near && items.length > 0

  return (
    <>
      <div
        ref={wrapRef}
        className="relative aspect-video overflow-hidden rounded-[20px] border border-edge"
      >
        {/*
          Первый кадр обычной картинкой: он держит бокс до монтирования слайдера
          и остаётся единственным содержимым без скриптов. Всегда маленький
          вариант — под непрозрачным канвасом он живёт доли секунды, а на
          телефоне это ровно та же ссылка, что возьмёт слайдер, то есть попадание
          в кеш вместо второй загрузки.
          eslint-disable-next-line @next/next/no-img-element
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shotUrl(shots[0], 'small')}
          alt={`Скриншот — ${name}`}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />

        {ready && (
          <div className="absolute inset-0">
            <MorphSlider
              items={items}
              radius={20}
              autoplay={visible && !reduced}
              autoplayDelay={4.5}
              showCaptions={false}
              label={`Скриншоты — ${name}`}
              onChange={setCurrent}
              onActivate={() => setOpen(current)}
            />
          </div>
        )}
      </div>

      <Lightbox
        images={fullShots}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
