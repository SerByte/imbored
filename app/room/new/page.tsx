'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { bounceTo, steamLoginFor } from '@/lib/destination'
import { isNeedSteam, writerStore } from '@/lib/writer'
import { Spinner } from '@/components/Spinner'

/**
 * Страница-действие: заходишь — создаётся комната, и тебя уносит в неё.
 *
 * Смотреть тут не на что, поэтому и цена ошибки здесь выше обычного: если
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
 */
type Phase = 'creating' | 'failed' | 'busy' | 'needsteam'

export default function NewRoomPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('creating')
  const started = useRef(false)

  const create = useCallback(async () => {
    setPhase('creating')
    try {
      const res = await fetch('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood: { time: 'long', vibe: 'engaged', social: 'friends' } }),
      })
      if (res.status === 401) {
        router.push(bounceTo('/room/new'))
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
      if (data.roomId) router.push(`/room/${data.roomId}`)
      else setPhase('failed')
    } catch {
      setPhase('failed')
    }
  }, [router])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void create()
  }, [create])

  if (phase === 'creating') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5">
        <Spinner />
        <p className="text-dim text-sm">Создаю комнату для пати…</p>
      </div>
    )
  }

  if (phase === 'needsteam') {
    return (
      <div className="flex-1 flex items-center justify-center px-5 py-24">
        <div className="max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col items-center gap-5 anim-reveal">
          <h1 className="text-xl font-bold tracking-tight">Комнату создаёт вошедший через Steam</h1>
          <p className="text-dim text-sm leading-relaxed">
            Ссылка на профиль не доказывает, что профиль твой. По ней можно смотреть подборки и
            голосовать в чужих пати, а создавать свои и сохранять оценки — после входа.
          </p>
          <a href={steamLoginFor('/room/new')} className="btn-ember is-block py-3">
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
          {phase === 'busy' ? 'Слишком много комнат подряд' : 'Не получилось создать комнату'}
        </h1>
        <p className="text-dim text-sm leading-relaxed">
          {phase === 'busy'
            ? 'С твоего адреса за последний час создано много комнат. Подожди немного — или подсядь к уже открытой пати.'
            : 'Скорее всего, это на нашей стороне. Обычно помогает повторить.'}
        </p>
        {/* Повтор на месте, а не ссылка на эту же страницу: перезаход сюда
            прошёл бы через started.current и снова упёрся бы в ту же попытку. */}
        {phase === 'failed' && (
          <button type="button" onClick={() => void create()} className="btn-ember is-block py-3">
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
