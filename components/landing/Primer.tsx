'use client'

import { useState } from 'react'
import { GameArt } from '@/components/GameArt'
import { Eyebrow, SectionLabel } from '@/components/Labels'
import type { LandingCard, LandingWallGame, MoodKey } from '@/lib/landing'
import { plural } from '@/lib/plural'

/**
 * «Так это выглядит» — работа продукта до всякого логина.
 *
 * Главная семь версий подряд просила библиотеку Steam, не показав ни одной
 * карточки. Здесь стоит настоящая выдача настоящего конвейера — на демо-
 * библиотеке, и об этом сказано прямо первой же строкой, а не мелким шрифтом
 * внизу. Демо, выданное за твоё, было бы ровно тем враньём, от которого
 * продукт отказывается на странице поддержки.
 *
 * ПЕРЕКЛЮЧАТЕЛЕЙ ДВА, А ВОПРОСОВ В ПОДБОРЕ ТРИ, и про это тоже сказано прямо.
 * Ось времени на 22 играх почти не двигает выдачу (см. докблок lib/landing.ts),
 * а переключатель, который ничего не меняет, обещает реакцию и тут же
 * опровергает себя первым же тапом.
 *
 * aria-pressed, а не role="radio": тот же приём, что у переключателя источника
 * на выдаче. Выбранное состояние передаётся не только цветом — иначе оно
 * пропадает для скринридера и для того, кто не различает ember на стекле.
 */

const VIBES = [
  { value: 'chill', label: 'Расслабиться', hint: 'без стресса и потных ладоней' },
  { value: 'engaged', label: 'Напрячься', hint: 'думать, потеть, побеждать' },
] as const

const SOCIALS = [
  { value: 'solo', label: 'Один', hint: 'только я и игра' },
  { value: 'friends', label: 'С друзьями', hint: 'нужен мультиплеер или кооп' },
] as const

function Switch({
  axis,
  options,
  value,
  onPick,
}: {
  axis: string
  options: readonly { value: string; label: string; hint: string }[]
  value: string
  onPick: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow tone="faint">{axis}</Eyebrow>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(o.value)}
              /*
                .tap здесь не нужен и вреден. Кнопка и так 56 px в высоту —
                две строки плюс py-2.5, — а невидимая зона в 44 px добавляет
                по 6 px с боков и съедает зазор gap-2: замерено, соседние
                кнопки перекрывались на 4 px, то есть воровали друг у друга
                нажатия. Утилита написана для строк-ссылок высотой в строку,
                а не для настоящих кнопок.
              */
              className={`cursor-pointer rounded-[14px] px-4 py-2.5 text-left transition ${
                on ? 'bg-ember/20 text-ember-text' : 'glass glass-hover text-dim'
              }`}
            >
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="block text-xs text-faint">{o.hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Primer({
  picks,
  wall,
  libraryCount,
  libraryHours,
}: {
  picks: Record<MoodKey, LandingCard[]>
  wall: LandingWallGame[]
  libraryCount: number
  libraryHours: number
}) {
  const [vibe, setVibe] = useState<'chill' | 'engaged'>('chill')
  const [social, setSocial] = useState<'solo' | 'friends'>('solo')
  const key = `${vibe}:${social}` as MoodKey
  const chosen = picks[key]
  const chosenIds = new Set(chosen.map((c) => c.appid))

  return (
    <section id="primer" className="mx-auto w-full max-w-6xl px-5 py-20 md:py-28">
      <SectionLabel as="h2" className="mb-2">
        Так это выглядит
      </SectionLabel>
      {/*
        Рамка честности стоит ПЕРВОЙ и обычным цветом. Ужать её в подпись
        значило бы спрятать единственное, что отличает демонстрацию от вранья.
      */}
      <p className="mb-8 max-w-xl text-sm leading-relaxed text-dim">
        Ниже — чужая библиотека: {libraryCount}{' '}
        {plural(libraryCount, 'игра', 'игры', 'игр')} демо-игрока,{' '}
        {libraryHours.toLocaleString('ru-RU')} {plural(libraryHours, 'час', 'часа', 'часов')}.
        Твоя будет другой, механика та же.
      </p>

      <div className="mb-8 flex flex-wrap gap-6">
        <Switch axis="Вайб" options={VIBES} value={vibe} onPick={(v) => setVibe(v as 'chill')} />
        <Switch
          axis="Компания"
          options={SOCIALS}
          value={social}
          onPick={(v) => setSocial(v as 'solo')}
        />
      </div>
      <p className="mb-10 max-w-xl text-sm text-dim">
        Третий вопрос — сколько у тебя времени — задаём в самом подборе.
      </p>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/*
          min-w-0 на обеих колонках обязателен. Автоминимум элемента сетки —
          это ширина его содержимого, и стена обложек распирала колонку до
          399 px в контейнере шириной 335: замерено на 375 px, страница
          выезжала за экран на 44. На широком экране этого не видно, потому
          что там колонки объявлены через minmax(0,…) — а на телефоне сетка
          однополосная, и потолок брать неоткуда.
        */}
        {/* СТЕНА: вся библиотека, из которой вынуты пять */}
        <div className="min-w-0">
          <Eyebrow tone="faint" className="mb-3">
            Из чего выбираем
          </Eyebrow>
          <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-4">
            {wall.map((g) => {
              const on = chosenIds.has(g.appid)
              return (
                <li key={g.appid}>
                  <GameArt
                    appid={g.appid}
                    name={g.name}
                    headerImage={g.headerImage}
                    art={g.art}
                    sizes="80px"
                    className={`aspect-[460/215] w-full rounded-[6px] object-cover transition ${
                      on ? 'ring-2 ring-ember' : 'opacity-35'
                    }`}
                  />
                </li>
              )
            })}
          </ul>
        </div>

        {/* ПЯТЁРКА: то, что выбрал движок под текущие переключатели */}
        <div className="min-w-0">
          <Eyebrow className="mb-3">Что предложит</Eyebrow>
          <ul className="flex flex-col gap-2">
            {chosen.map((c) => (
              <li
                key={c.appid}
                className="glass flex items-center gap-4 overflow-hidden rounded-[14px] p-2.5"
              >
                <GameArt
                  appid={c.appid}
                  name={c.name}
                  headerImage={c.headerImage}
                  art={c.art}
                  sizes="120px"
                  className="aspect-[460/215] w-[92px] shrink-0 rounded-[8px] object-cover md:w-[120px]"
                />
                <div className="min-w-0 flex-1">
                  <Eyebrow>{c.badge}</Eyebrow>
                  <div className="mt-1 truncate font-display text-display-xs">{c.name}</div>
                  <div className="mt-0.5 truncate text-xs text-faint">{c.tags.join(' · ')}</div>
                </div>
              </li>
            ))}
          </ul>
          {/*
            Причины у карточек здесь нет намеренно, и это не экономия места:
            все её шаблоны обращаются на «ты» и говорят про твою библиотеку —
            «ты не запускал», «ты открыл и закрыл». Библиотека чужая, значит
            это была бы прямая неправда. Поля с причиной нет и в данных.
          */}
          <p className="mt-4 max-w-md text-xs leading-relaxed text-faint">
            Своё идёт первым, покупок в пятёрке не больше двух. Причину, почему именно эта игра,
            подбор пишет уже по твоей библиотеке.
          </p>
        </div>
      </div>
    </section>
  )
}
