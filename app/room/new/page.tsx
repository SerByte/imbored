'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'

export default function NewRoomPage() {
  const router = useRouter()
  const [error, setError] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const res = await fetch('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood: { time: 'long', vibe: 'engaged', social: 'friends' } }),
      })
      if (res.status === 401) {
        router.push('/?error=nosession')
        return
      }
      const data = (await res.json()) as { roomId?: string }
      if (data.roomId) router.push(`/room/${data.roomId}`)
      else setError(true)
    })()
  }, [router])

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5">
      {error ? (
        <p className="text-dim">Не получилось создать комнату. Попробуй ещё раз.</p>
      ) : (
        <>
          <Spinner />
          <p className="text-dim text-sm">Создаю комнату для пати…</p>
        </>
      )}
    </div>
  )
}
