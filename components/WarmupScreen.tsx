'use client'

import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { CountNumber } from '@/components/CountNumber'
import { useLocale } from '@/components/LocaleProvider'
import { ProgressRing } from '@/components/ProgressRing'
import { Spinner } from '@/components/Spinner'
import { legacyArtUrl, type GameArtUrls } from '@/lib/art'
import { fmtNumber, pl, tr } from '@/lib/i18n'
import { warmupPercent, warmupStage, type WallMemo, type WarmupProgress } from '@/lib/warmup'
import { NARROW_WALL_MEDIA, stopWallLoads, wallPool, wallRows } from '@/lib/warmupwall'
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
 *
 * Язык — из контекста (useLocale): экран стоит на /play, /daily и /explore, а
 * message каждая страница приносит уже на своём языке. Подпись в кольце
 * (160 px) по-английски короче русской — «done» против «разобрано»: одно
 * «read» под числом читалось глаголом и не говорило, что разбирают.
 */
/**
 * Игра, которая вышла из стены: её постер встаёт в центр перед выдачей.
 *
 * poster — ровно тот адрес, что страница дождалась загруженным
 * (lib/warmupwall: chosenPoster и posterReady). Без srcSet и без цепочки
 * запасных: такт начинается, только когда этот файл уже раскодирован, иначе
 * его не бывает вовсе.
 */
export type ChosenGame = { appid: number; name: string; art?: GameArtUrls | null; poster: string }

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
  const locale = useLocale()
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
      {wall.length > 0 && <PosterWall ids={wall} stop={chosen !== null} />}
      <div aria-hidden className="grain" />

      {chosen && (
        <div aria-hidden className="warmup-chosen">
          <div className="warmup-chosen-poster">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chosen.poster} alt="" decoding="async" className="h-full w-full object-cover" />
          </div>
          <p className="warmup-chosen-line">
            {games > 1
              ? tr(locale, { ru: `Из ${fmtNumber(locale, games)} — одна`, en: `One of ${fmtNumber(locale, games)}` })
              : tr(locale, { ru: 'Вот она', en: 'Here it is' })}
          </p>
        </div>
      )}

      {/* На /en — во всю ширину. Строка статуса ниже стоит абсолютно и своей
          ширины колонке не даёт: колонка была шириной в самую длинную строку
          фактов. Русская «из них ты не открывал ни разу» шире «Осталось
          разобрать 1204 игры», а английская «never launched» короче «412 games
          left to go through» — и статус переносился на любом экране. Русской
          разметке класс не добавлен: она по договору прежняя до байта. */}
      <div className={`warmup-ui relative flex flex-col items-center gap-7${locale === 'en' ? ' w-full' : ''}`}>
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
              ariaLabel={tr(locale, { ru: `Разобрано ${Math.round(pct)}%`, en: `${Math.round(pct)}% done` })}
              label={
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className="text-3xl font-extrabold tracking-[-0.03em] text-ink"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {Math.round(pct)}%
                  </span>
                  <span className="text-[11px] text-faint">{tr(locale, { ru: 'разобрано', en: 'done' })}</span>
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
          {warmupStage(message, progress, locale)}
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
              {pl(locale, progress.library.games, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })}{' '}
              {tr(locale, { ru: 'в библиотеке', en: 'in your library' })}
            </p>
            {/* Время скрыто — ни числа нетронутых, ни нуля: это галочка Steam.
                «Похоже» — признак угадан по нулям (lib/playtime.ts) и бывает
                ложным у десятка ни разу не запущенных игр */}
            {progress.library.timeHidden ? (
              <p className="text-sm text-dim mt-1">
                {tr(locale, {
                  ru: 'похоже, время в них скрыто настройками Steam',
                  en: 'playtime seems to be hidden by your Steam privacy settings',
                })}
              </p>
            ) : progress.library.untouched > 0 && (
              <p className="text-sm text-dim mt-1">
                <CountNumber
                  value={progress.library.untouched}
                  delay={260}
                  className="font-bold tabular-nums text-ember-text"
                />{' '}
                {tr(locale, { ru: 'из них ты не открывал ни разу', en: 'never launched' })}
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
 * же картинку, и петля бесшовная. Сколько постеров в ряду и как добирается
 * маленькая библиотека — wallPool в lib/warmupwall: на телефоне стена
 * короче, потому что дальше края стекла её не видно, а качалась она вся.
 *
 * СТЕНА НЕ ДЕРЖИТ КАНАЛ ПОСЛЕ СЕБЯ. Стена — фон ожидания, а за ней по тому
 * же хосту едут постер выбранной игры и арт героя выдачи. Поэтому:
 *   • приоритет низкий — видимые плитки и так в экране, а вперёд них никто,
 *     кроме постера и героя, не встанет;
 *   • с тактом выбора (stop) и с уходом экрана недокачанные плитки
 *     обрываются (stopWallLoads): вынутый из DOM <img> иначе докачивает
 *     своё, и на телефоне стена доезжала через 4–7 с после того, как её не
 *     стало, — вперёд арта героя.
 *
 * Обрыв при уходе — только если узел и правда отцеплен: в StrictMode
 * эффект в разработке «размонтируется» понарошку, и стена оставалась бы
 * пустой.
 */
function PosterWall({ ids, stop }: { ids: number[]; stop: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Один раз на монтирование: стена не пересобирается на повороте экрана.
  // На сервере её нет — без стены прогрева она не рисуется вовсе
  const [narrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(NARROW_WALL_MEDIA).matches === true,
  )
  useEffect(() => {
    const root = ref.current
    if (!root) return
    if (stop) stopWallLoads(root)
    return () => {
      if (!root.isConnected) stopWallLoads(root)
    }
  }, [stop])
  const rows = wallRows(wallPool(ids, narrow))
  return (
    <div ref={ref} aria-hidden className="pwall">
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
                fetchPriority="low"
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
