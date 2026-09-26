'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { parseRoomCode } from '@/lib/room'

/**
 * «Есть код? Войти».
 *
 * Код комнаты предлагают диктовать: кнопка копирования при отказе буфера так
 * и пишет — «Не вышло — продиктуй код», экран «ты тут один» делает его
 * героем, а /rooms обещает «код из шести символов». Ввести же его было
 * негде: ?join= принимался только из адреса. Хост в вебвью мессенджера,
 * буфер отказал, друг слышит «FCPK8G», открывает сайт — и не находит, куда
 * это набрать. В установленном приложении нет и адресной строки.
 *
 * Сессия здесь не нужна: страница комнаты сама разберётся, кто пришёл, —
 * гостю предложит подключиться, вошедшему — войти.
 *
 * Строка ошибки отрисована всегда, пустой: живая область, вставленная уже с
 * текстом, звучит не во всех связках скринридера и браузера.
 */
export function RoomCodeForm({ className = '' }: { className?: string }) {
  const router = useRouter()
  const [raw, setRaw] = useState('')
  const [bad, setBad] = useState(false)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const code = parseRoomCode(raw)
        if (!code) {
          setBad(true)
          return
        }
        router.push(`/room/${code}`)
      }}
      className={`flex w-full max-w-xs flex-col gap-2 ${className}`}
    >
      <label htmlFor="room-code" className="text-xs text-dim">
        Есть код комнаты?
      </label>
      {/* Поле и кнопка — одной стеклянной пилюлей, как вход на главной */}
      <div className="join">
        {/* Заглавными и моноширинным — как код набран везде, где его
            показывают; значение при этом остаётся тем, что ввели, а
            регистр и пробелы снимает parseRoomCode. */}
        <input
          id="room-code"
          name="code"
          type="text"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value)
            setBad(false)
          }}
          placeholder="Шесть символов"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={bad}
          aria-describedby="room-code-error"
          className="min-w-0 flex-1 font-mono uppercase placeholder:font-sans placeholder:normal-case"
        />
        <button
          type="submit"
          disabled={!raw.trim()}
          className="btn-glass shrink-0 disabled:opacity-40"
        >
          Войти
        </button>
      </div>
      <p id="room-code-error" role="status" className={bad ? 'text-xs text-danger' : 'sr-only'}>
        {bad ? 'Код — шесть латинских букв и цифр, например FCPK8G.' : ''}
      </p>
    </form>
  )
}
