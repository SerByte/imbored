'use client'

import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import Link from 'next/link'
import { useRef } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { CountNumber } from '@/components/CountNumber'
import { GameArt } from '@/components/GameArt'
import { SplitHeading } from '@/components/SplitHeading'
import type { FeedItem } from '@/lib/db'
import { dateLabel } from '@/lib/freshness'
import type { GameMeta } from '@/lib/types'
import { byline, freshness } from './format'
import { useNow } from './Now'

/**
 * Обложка ленты: главное обновление во весь экран.
 *
 * Два независимых источника арта, и в этом весь смысл. Фоном идёт library_hero
 * игры, поверх — картинка самого патча из RSS-вложения. Она лежала в базе с
 * первого дня и не показывалась нигде: издатель рисует её именно к этому
 * обновлению, так что это самый честный визуал, какой у нас есть.
 *
 * Разная скорость параллакса разводит слои по глубине: фон отстаёт от скролла,
 * кадр патча обгоняет. Обычный приём, но здесь он несёт смысл — «за игрой» и
 * «про это обновление» перестают быть одной плоскостью.
 *
 * Слои строго порядком разметки, без z-index: арт → скрим → BlurBand → зерно →
 * контент. Это правило проекта, и нарушать его нельзя — с z-index полоса
 * размытия поднимается над текстом и мылит заголовок.
 */
export function Cover({
  item,
  meta,
  nowSec,
  changes,
  label,
}: {
  item: FeedItem
  meta?: GameMeta
  nowSec: number
  /** правок в патче; считается на сервере — тело сюда больше не едет */
  changes: number
  /** «в популярных играх» — какую из лент читает человек; без вкладок не нужна */
  label?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const now = useNow(nowSec)

  // offset вместо абсолютных пикселей: прогресс 0→1 за то время, пока герой
  // уходит вверх, и это одинаково работает на любой высоте экрана
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })

  // Хуки зовём безусловно — правила хуков; отключаем движение на применении
  const artY = useTransform(scrollYProgress, [0, 1], ['0%', '18%'])
  const artScale = useTransform(scrollYProgress, [0, 1], [1, 1.12])
  const stillY = useTransform(scrollYProgress, [0, 1], ['0%', '-26%'])
  const textY = useTransform(scrollYProgress, [0, 1], ['0%', '32%'])
  const textFade = useTransform(scrollYProgress, [0, 0.75], [1, 0])

  const name = meta?.name ?? `Игра ${item.appid}`

  const studio = byline(meta?.developer, meta?.releaseYear)
  const published = new Date(item.publishedAt * 1000)

  return (
    <section
      ref={ref}
      className="relative flex min-h-screen flex-col justify-end overflow-hidden"
      style={{ minHeight: '100svh' }}
    >
      {/* фон — арт игры */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        style={reduced ? undefined : { y: artY, scale: artScale }}
      >
        <GameArt
          appid={item.appid}
          name={name}
          headerImage={meta?.headerImage}
          art={meta?.art}
          variant="hero"
          eager
          className="h-full w-full object-cover"
        />
      </motion.div>

      {/* скрим: снизу почти непрозрачный, чтобы текст лёг на плотное */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to top, #07080c 6%, rgba(7,8,12,0.88) 32%, rgba(7,8,12,0.45) 64%, rgba(7,8,12,0.7) 100%)',
        }}
      />
      <BlurBand height="44vh" dir="up" />
      <div aria-hidden className="grain" />

      <div className="relative mx-auto w-full max-w-6xl px-5 pb-20 pt-40 md:pb-28">
        {/* Вторая колонка появляется только под реальный кадр патча: у 550 из
            1163 обновлений своей картинки нет, и пустые 300px просто ужимали бы
            заголовок ни за чем.

            Разрез с lg, а не с md, и это продолжение той же мысли. Колонка
            фиксирована на 300px, а кегль заголовка считается от вьюпорта
            (clamp с 7vw), поэтому чем уже экран, тем большую долю кадр
            отъедает: на 768 это 45% контейнера, на 1440 — 27%. Замер строки
            при кадре: на 768 колонка 373px при кегле 53.8 — четырнадцать
            знаков, на 1440 колонка 812 при кегле 88 — восемнадцать с
            половиной. С порогом lg доля выравнивается: на 1024 те же
            восемнадцать. Ниже — одна колонка, кадр идёт баннером под
            заголовком. */}
        <div
          className={
            item.imageUrl
              ? 'grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end'
              : 'grid gap-10'
          }
        >
          <motion.div style={reduced ? undefined : { y: textY, opacity: textFade }}>
            {/* Заголовок страницы, а не игры: h1 обязан говорить, где ты, даже
                когда на весь экран стоит чужое название. Игра идёт следом h2.
                Метка ленты живёт здесь же: переключатель остался экраном ниже,
                и после перехода это единственное указание, куда ты попал. */}
            <h1 className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.42em] text-dim">
              <span aria-hidden className="h-px w-10 bg-rule" />
              Что нового
              {label ? (
                <span className="tracking-[0.2em] text-ink/50">· {label}</span>
              ) : null}
            </h1>

            <p className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-dim">
              {freshness(item.publishedAt, now)}
              {studio ? <span className="text-ink/50"> · {studio}</span> : null}
            </p>

            <SplitHeading
              as="h2"
              className="font-display text-[clamp(2.4rem,7vw,5.5rem)] font-extrabold leading-[0.92] tracking-tight"
              delay={0.18}
            >
              {name}
            </SplitHeading>

            <p className="mt-5 max-w-xl text-lg font-medium leading-snug text-ink/90 md:text-xl">
              {item.title}
            </p>

            {item.tldr ? (
              <p className="mt-3 max-w-xl leading-relaxed text-dim">{item.tldr}</p>
            ) : null}

            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
              {meta?.ccu ? (
                <span className="flex flex-col">
                  <CountNumber
                    value={meta.ccu}
                    delay={320}
                    className="font-mono text-2xl font-bold tabular-nums md:text-3xl"
                  />
                  <span className="mt-0.5 text-xs text-dim">играют прямо сейчас</span>
                </span>
              ) : null}
              {changes > 0 ? (
                <span className="flex flex-col">
                  <CountNumber
                    value={changes}
                    delay={420}
                    className="font-mono text-2xl font-bold tabular-nums md:text-3xl"
                  />
                  <span className="mt-0.5 text-xs text-dim">
                    {changes === 1 ? 'правка в патче' : 'правок в патче'}
                  </span>
                </span>
              ) : null}
              <Link
                href={`/game/${item.appid}`}
                className="text-sm font-semibold underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
              >
                Что ещё меняли
              </Link>
            </div>
          </motion.div>

          {/* кадр из самого патча — второй слой, обгоняет фон */}
          {item.imageUrl ? (
            <motion.figure
              aria-hidden
              className="hidden md:block"
              style={reduced ? undefined : { y: stillY }}
            >
              {/*
                lazy, а не eager, и это про телефон.

                Обёртка выше — hidden md:block, то есть на мобильной ширине
                кадр не показывается никогда. Но display:none не отменяет
                загрузку <img src>, а eager снимает и ту отсрочку, которую
                браузер дал бы сам: на телефоне качалось 201 КБ (замер по
                текущему ведущему патчу) ради картинки, которой не будет.

                Ленивая картинка внутри невидимого контейнера в кадр не
                попадает никогда — значит и не грузится.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                className="w-full rounded-[20px] border border-edge object-cover shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]"
              />
              <figcaption className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
                {/* Зона зафиксирована в dateLabel — см. lib/freshness. */}
                <time dateTime={published.toISOString()}>{dateLabel(item.publishedAt)}</time>
              </figcaption>
            </motion.figure>
          ) : null}
        </div>
      </div>
    </section>
  )
}
