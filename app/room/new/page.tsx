'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { bounceTo, steamLoginFor } from '@/lib/destination'
import { ROOM_PRESETS, roomPresetByKey, type RoomPreset } from '@/lib/presets'
import { isNeedSteam, writerStore } from '@/lib/writer'
import { Icon } from '@/components/Icon'
import { PosterFan, type FanGame } from '@/components/PosterFan'
import { Spinner } from '@/components/Spinner'
import { useSearch } from '@/components/useSearch'

/**
 * Страница-действие: выбираешь настроение — создаётся комната, и тебя уносит в
 * неё.
 *
 * Смотреть тут почти не на что, поэтому и цена ошибки здесь выше обычного: если
 * действие не состоялось, у человека на экране не остаётся НИЧЕГО — ни
 * содержимого, ни выхода. Раньше именно это и происходило.
 *
 * Что было сломано. Тело эффекта жило в `void (async () => …)()` без единого
 * try: любой сетевой сбой отклонял промис в пустоту, `error` не выставлялся, и
 * спиннер крутился до перезагрузки страницы. Ровно тот же класс ошибки, что
 * описан в докблоке lib/warmup.ts про копию цикла на /daily. Вторая половина —
 * `res.json()` без проверки `ok`: пятисотка отдаёт HTML, разбор бросает, и
 * ветка ошибки ниже была недостижима в принципе.
 *
 * 'needsteam' — сессия по вставленной ссылке: комнату создаёт только вошедший
 * через Steam (requireWriter в lib/server). «Попробовать снова» здесь соврало
 * бы, поэтому вместо повтора — вход, который вернёт сюда же и создаст
 * комнату, и дорога к открытым пати, куда подсесть можно и так.
 *
 * 'choosing' — первый шаг: хост выбирает настроение комнаты (ROOM_PRESETS), и
 * колода собирается под него. Раньше тело запроса зашивало одно настроение на
 * все комнаты, а колода его и вовсе не читала. Выбор — один тап, и он же
 * создаёт комнату: отдельной кнопки «создать» нет, как не было и раньше.
 *
 * Выбранное едет через вход ключом ?preset= (roomQuery в lib/destination):
 * развёрнутый на вход хост возвращается сюда и получает комнату сразу, без
 * повторного вопроса.
 */

/*
 * Веер на плитке настроения — кооп-игры, в которые с этим настроением уходят
 * компанией. Иллюстрация, а не колода: колоду соберёт сервер из ваших
 * библиотек. Эмодзи пресетов остаются в данных — их показывает шапка комнаты.
 */
const PRESET_ART: Record<string, readonly FanGame[]> = {
  evening: [
    { appid: 548430, name: 'Deep Rock Galactic' },
    { appid: 1426210, name: 'It Takes Two' },
    { appid: 892970, name: 'Valheim' },
  ],
  quick: [
    { appid: 252950, name: 'Rocket League' },
    { appid: 730, name: 'Counter-Strike 2' },
  ],
  cozy: [
    { appid: 413150, name: 'Stardew Valley' },
    { appid: 105600, name: 'Terraria' },
    { appid: 648800, name: 'Raft' },
  ],
  talk: [
    { appid: 945360, name: 'Among Us' },
    { appid: 728880, name: 'Overcooked! 2' },
  ],
}
type Phase = 'choosing' | 'creating' | 'failed' | 'busy' | 'needsteam'

export default function NewRoomPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('choosing')
  /** что выбрано тапом; до тапа — то, с чем вернулись со входа */
  const [picked, setPicked] = useState<RoomPreset | null>(null)
  const started = useRef(false)

  /*
   * Настроение, с которым вернулись со входа (?preset=). Через useSearch, а не
   * чтением адреса в эффекте: эффект, который ставит фазу сам, линтер
   * справедливо называет каскадным рендером, а здесь фаза выводится из
   * адреса прямо в рендере. Эффект ниже зовёт запрос только при найденном
   * пресете, поэтому пустой снимок кадра гидратации (см. components/useSearch)
   * запроса с чужим настроением не пошлёт — он не пошлёт никакого.
   */
  const search = useSearch()
  const back = roomPresetByKey(new URLSearchParams(search).get('preset'))
  const preset = picked ?? back ?? ROOM_PRESETS[0]
  const view: Phase = phase === 'choosing' && back ? 'creating' : phase

  const send = useCallback(
    async (p: RoomPreset) => {
      try {
        const res = await fetch('/api/room/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mood: p.mood }),
        })
        if (res.status === 401) {
          router.push(bounceTo('/room/new', new URLSearchParams({ preset: p.key })))
          return
        }
        // Своя ветка у 429: «попробуй ещё раз» — вредный совет, когда упёрся в
        // ограничитель частоты, а ждать надо минуты.
        if (res.status === 429) {
          setPhase('busy')
          return
        }
        if (await isNeedSteam(res)) {
          // Тот же ответ узнают и остальные страницы документа (lib/writer)
          writerStore.set(false)
          setPhase('needsteam')
          return
        }
        if (!res.ok) {
          setPhase('failed')
          return
        }
        const data = (await res.json()) as { roomId?: string }
        // replace, а не push: «назад» из комнаты не должен приводить сюда. С
        // ?preset= в адресе этот заход создал бы ВТОРУЮ комнату, а без него
        // показал бы выбор, который уже сделан
        if (data.roomId) router.replace(`/room/${data.roomId}`)
        else setPhase('failed')
      } catch {
        setPhase('failed')
      }
    },
    [router],
  )

  const create = (p: RoomPreset) => {
    setPicked(p)
    setPhase('creating')
    void send(p)
  }

  // Вернулся со входа с уже выбранным настроением — создаём сразу. Один раз:
  // повтор после отказа — кнопкой, с тем же пресетом
  useEffect(() => {
    if (!back || started.current) return
    started.current = true
    void send(back)
  }, [back, send])

  if (view === 'choosing') {
    return (
      <div className="flex-1 flex items-center justify-center px-5 py-24">
        <div className="max-w-3xl w-full flex flex-col gap-8 anim-reveal">
          <div className="text-center flex flex-col items-center gap-2">
            <h1 className="font-display text-display-md">Какой будет вечер?</h1>
            <p className="max-w-md text-dim text-sm leading-relaxed">
              Колода соберётся из ваших библиотек под это настроение — его увидят все, кто
              зайдёт в комнату.
            </p>
          </div>
          {/* Плитки с веером, как ответы квиза: постеры — примеры того, во
              что компания уходит с этим настроением, а не сама колода */}
          <ul className="grid gap-4 md:grid-cols-2">
            {ROOM_PRESETS.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => create(p)}
                  className="panel-lift quiz-tile fan-host w-full px-6 py-6 text-left cursor-pointer"
                >
                  <PosterFan games={PRESET_ART[p.key] ?? []} />
                  <span aria-hidden className="quiz-scrim" />
                  <span className="relative block text-[1.375rem] leading-tight font-extrabold tracking-[-0.025em]">
                    {p.label}
                  </span>
                  <span className="relative block text-sm text-dim mt-1.5">{p.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/rooms" className="tap link-more self-center">
            <Icon name="back" size={16} />
            Подсесть к открытой пати
          </Link>
        </div>
      </div>
    )
  }

  if (view === 'creating') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5">
        <Spinner />
        <p className="text-dim text-sm">Создаю комнату для пати…</p>
      </div>
    )
  }

  if (view === 'needsteam') {
    return (
      <div className="flex-1 flex items-center justify-center px-5 py-24">
        <div className="max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col items-center gap-5 anim-reveal">
          <h1 className="text-xl font-bold tracking-tight">Комнату создаёт вошедший через Steam</h1>
          <p className="text-dim text-sm leading-relaxed">
            Ссылка на профиль не доказывает, что профиль твой. По ней можно смотреть подборки и
            голосовать в чужих пати, а создавать свои и сохранять оценки — после входа.
          </p>
          <a href={steamLoginFor(`/room/new?preset=${preset.key}`)} className="btn-ember is-block py-3">
            Войти через Steam
          </a>
          <Link href="/rooms" className="tap text-sm text-dim hover:text-ink transition-colors">
            ← Подсесть к открытой пати
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center px-5 py-24">
      <div className="max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col items-center gap-5 anim-reveal">
        <h1 className="text-xl font-bold tracking-tight">
          {view === 'busy' ? 'Слишком много комнат подряд' : 'Не получилось создать комнату'}
        </h1>
        <p className="text-dim text-sm leading-relaxed">
          {view === 'busy'
            ? 'С твоего адреса за последний час создано много комнат. Подожди немного — или подсядь к уже открытой пати.'
            : 'Скорее всего, это на нашей стороне. Обычно помогает повторить.'}
        </p>
        {/* Повтор на месте, а не ссылка на эту же страницу: перезаход сюда
            прошёл бы через started.current и снова упёрся бы в ту же попытку. */}
        {view === 'failed' && (
          <button type="button" onClick={() => create(preset)} className="btn-ember is-block py-3">
            Попробовать снова
          </button>
        )}
        <Link href="/rooms" className="tap text-sm text-dim hover:text-ink transition-colors">
          ← К списку пати
        </Link>
      </div>
    </div>
  )
}
