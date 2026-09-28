'use client'

import { AnimatePresence, m } from 'framer-motion'
import { Ambient } from '@/components/Ambient'
import { CountNumber } from '@/components/CountNumber'
import { GameArt } from '@/components/GameArt'
import { ProgressRing } from '@/components/ProgressRing'
import { Spinner } from '@/components/Spinner'
import { legacyArtUrl, type GameArtUrls } from '@/lib/art'
import { plural } from '@/lib/plural'
import { warmupPercent, warmupStage, type WallMemo, type WarmupProgress } from '@/lib/warmup'
import { Eyebrow } from '@/components/Labels'

/**
 * Экран ожидания прогрева.
 *
 * Был сделан для /play и сделан хорошо: кольцо с процентом вместо спиннера,
 * живая строка статуса, дыхание фона. На /daily всё это время висел голый
 * спиннер с неподвижной строкой — при том что ждать там ровно столько же.
 * Теперь экран один на оба места.
 *
 * Кольцо появляется только когда объём работы известен: до первого ответа
 * /api/prepare показывать «0%» было бы враньём, поэтому там спиннер.
 */
/** Игра, которая вышла из стены: её постер встаёт в центр перед выдачей */
export type ChosenGame = { appid: number; name: string; art?: GameArtUrls | null }

export function WarmupScreen({
  progress,
  message,
  caption,
  chosen = null,
  leaving = false,
  memo = null,
}: {
  progress: WarmupProgress | null
  message: string
  /**
   * Настроение одной строкой — то самое, которым закончился квиз.
   *
   * Шов между экранами. Раньше последний ответ вызывал router.push в том же
   * тике, и человек проваливался с вопроса на голый спиннер: ни один из
   * экранов не подтверждал, что его вообще услышали. Геометрический морф здесь
   * невозможен (Next сносит дерево квиза до монтирования выдачи), поэтому
   * непрерывность держится на содержании.
   *
   * Пусто на /daily и при заходе на /play напрямую — там никакого квиза не
   * было, и подпись была бы взята из воздуха.
   */
  caption?: string
  /**
   * «Из многих — одна»: выдача готова, и страница держит этот экран ещё на
   * такт (CHOSEN_MS в /play), пока постер выбранной игры выходит из стены.
   * null — обычное ожидание.
   */
  chosen?: ChosenGame | null
  /** Такт ухода: постер наплывает на экран и растворяется перед героем */
  leaving?: boolean
  /** Стена с прошлого прогрева — когда этот заход прогрев пропустил */
  memo?: WallMemo | null
}) {
  const pct = warmupPercent(progress)
  const known = progress !== null && progress.total > 0
  const wall = progress?.library?.wall ?? memo?.wall ?? []
  const games = progress?.library?.games ?? memo?.games ?? 0

  return (
    <div
      className={`warmup relative flex-1 flex flex-col items-center justify-center gap-7 px-5 overflow-hidden ${
        chosen ? 'is-chosen' : ''
      } ${leaving ? 'is-leaving' : ''}`}
    >
      <Ambient className="anim-breathe" />
      {wall.length > 0 && <PosterWall ids={wall} />}
      <div aria-hidden className="grain" />

      {chosen && (
        <div aria-hidden className="warmup-chosen">
          <div className="warmup-chosen-poster">
            <GameArt
              appid={chosen.appid}
              name={chosen.name}
              art={chosen.art}
              variant="poster"
              sizes="280px"
              eager
              className="h-full w-full object-cover"
            />
          </div>
          <p className="warmup-chosen-line">
            {games > 1 ? `Из ${games.toLocaleString('ru-RU')} — одна` : 'Вот она'}
          </p>
        </div>
      )}

      <div className="warmup-ui relative flex flex-col items-center gap-7">
        {/* Первое, что видно на этом экране, — то последнее, что человек здесь
            сказал. Раньше на его месте не было ничего: последний ответ квиза
            вызывал переход в том же тике, и вопрос сменялся спиннером. */}
        {caption && (
          <Eyebrow tone="faint" className="relative">
            {caption}
          </Eyebrow>
        )}

        <div className="relative">
          {known ? (
            <ProgressRing
              percent={pct}
              size={160}
              stroke={8}
              duration={600}
              // Без имени кольцо звучало голым «48%»: сорок восемь процентов
              // чего, из разметки не следует. Число здесь — по запросу, а не
              // вслух: в живую область уходит только этап (см. ниже)
              ariaLabel={`Разобрано ${Math.round(pct)}%`}
              label={
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className="text-3xl font-extrabold tracking-[-0.03em] text-ink"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {Math.round(pct)}%
                  </span>
                  <span className="text-[11px] text-faint">разобрано</span>
                </div>
              }
            />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center">
              <Spinner />
            </div>
          )}
        </div>

        {/*
          Живая область — этап, а не строка статуса.

          Видимая строка ниже была обычным <p>: скринридер слышал «Загрузка» от
          спиннера и дальше до минуты тишины. Отдать её в живую область как есть
          — хуже тишины: счётчик меняется на каждом ответе прогрева, и очередь
          из «осталось 812… 790… 765…» заглушила бы смену этапа, ради которой
          область и заводится. Поэтому здесь warmupStage: счётчик сворачивается
          в «Разбираю библиотеку…», остальные подписи идут как есть. Живёт всё
          время экрана — область, появившаяся вместе с текстом, не звучит.
        */}
        <p role="status" className="sr-only">
          {warmupStage(message, progress)}
        </p>

        {/* Строка статуса меняется по ходу — подменять её встык значит терять
            единственный сигнал, что что-то вообще происходит. Для скринридера
            она спрятана: этап сказан выше, число — именем кольца, а третий
            пересказ того же читался бы при каждом проходе по экрану. */}
        <div aria-hidden className="h-5 relative w-full max-w-sm text-center">
          {/* initial={false}: это самый первый экран после ответов, и его подпись
              приезжала в HTML с opacity:0. Пока не гидратируется — человек смотрит на
              крутящуюся дугу без единого слова о том, что происходит. Смена подписей
              по ходу прогрева продолжает перетекать как раньше. */}
          <AnimatePresence mode="wait" initial={false}>
            <m.p
              key={message}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-x-0 text-dim text-sm"
            >
              {message}
            </m.p>
          </AnimatePresence>
        </div>

        {/* Факты о человеке вместо счётчика нашей работы.
            «Осталось разобрать 812 игр» — это отчёт сервиса о себе. Числа ниже
            считаются по снапшоту без единого байта метаданных, то есть приходят
            с первым же ответом прогрева, и говорят про того, кто ждёт. */}
        {progress?.library && progress.library.games > 0 && (
          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="text-center"
          >
            <p className="text-sm text-dim">
              <CountNumber value={progress.library.games} className="font-bold tabular-nums text-ink" />{' '}
              {plural(progress.library.games, 'игра', 'игры', 'игр')} в библиотеке
            </p>
            {progress.library.untouched > 0 && (
              <p className="text-sm text-dim mt-1">
                <CountNumber
                  value={progress.library.untouched}
                  delay={260}
                  className="font-bold tabular-nums text-ember-text"
                />{' '}
                из них ты не открывал ни разу
              </p>
            )}
          </m.div>
        )}
      </div>
    </div>
  )
}

/**
 * СТЕНА — обложки его библиотеки, три ряда навстречу друг другу.
 *
 * «Изучаю твою библиотеку» было подписью под кольцом; теперь это видно: за
 * кольцом едет его собственная полка, самые наигранные первыми (libraryWall).
 * Двигается только transform, и без blur и blend на движущемся слое — та же
 * заметка про кадр, что у ленты главной (docs/landing-visual.md).
 *
 * Ряд — треть стены, повторённая дважды: сдвиг на −50% возвращает его в ту
 * же картинку, и петля бесшовная. Маленькую библиотеку добираем повтором,
 * чтобы ряд был шире экрана и на петле не появлялась дыра.
 */
const WALL_MIN = 18

function PosterWall({ ids }: { ids: number[] }) {
  const pool = ids.length >= WALL_MIN ? ids : Array.from({ length: WALL_MIN }, (_, i) => ids[i % ids.length])
  const rows = [0, 1, 2].map((r) => pool.filter((_, i) => i % 3 === r))
  return (
    <div aria-hidden className="pwall">
      <div className="pwall-grid">
        {rows.map((row, r) => (
          <div key={r} className="pwall-row">
            {[...row, ...row].map((appid, i) => (
              // Прямой <img>: файл на CDN Steam, как у GameArt. У старых игр
              // вертикального постера нет — такая обложка просто прячется
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={legacyArtUrl(appid, 'poster')}
                alt=""
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden'
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="pwall-shade" />
    </div>
  )
}
