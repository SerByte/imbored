'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { parseCompatInput } from '@/lib/compatlink'

const ERROR_TEXT: Record<string, string> = {
  badinput: 'Это не похоже на ссылку совместимости или профиль Steam.',
  notfound: 'Не нашли такой профиль. Проверь ник или пришли ссылку целиком.',
  nokey: 'Ник сейчас не разобрать — пришли ссылку совместимости целиком.',
  ratelimited: 'Слишком много попыток подряд. Подожди пару минут.',
  fail: 'Не получилось проверить. Попробуй ещё раз.',
}

/**
 * Вторая половина фичи «Совместимость».
 *
 * Хаб умел ровно одно — отдать СВОЮ ссылку. Обратной операции не было нигде:
 * человек, которому ссылку прислали текстом (а её присылают текстом — это
 * весь способ распространения фичи), не мог с ней ничего сделать, кроме как
 * открыть вручную.
 *
 * Числовой id разбираем на месте и уходим без единого запроса — это самый
 * частый случай, наша же ссылка. В сеть идём только за ником: в
 * steamcommunity.com/id/name числового идентификатора нет, и придумать его
 * нельзя.
 */
export function OpenCompatLink() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = parseCompatInput(input)
    if (!parsed) {
      setError('badinput')
      return
    }
    if (parsed.kind === 'steamid64') {
      router.push(`/compat/${parsed.value}`)
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/compat/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const data = (await res.json().catch(() => ({}))) as { steamid?: string; error?: string }
      if (data.steamid) {
        router.push(`/compat/${data.steamid}`)
        return
      }
      setError(data.error ?? 'fail')
    } catch {
      setError('fail')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 text-left">
      {/* Подпись, а не placeholder: placeholder исчезает по первому символу
          ровно тогда, когда человек и начинает сомневаться, туда ли он пишет.
          Тот же довод записан на лендинге у поля профиля. */}
      <label htmlFor="compat-link" className="text-xs text-faint">
        Или вставь ссылку друга
      </label>
      <div className="flex gap-2">
        <input
          id="compat-link"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="imbored.cc/compat/… или профиль Steam"
          className="min-w-0 flex-1 rounded-[14px] bg-surface border border-edge px-4 py-2.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="glass glass-hover rounded-[14px] px-5 py-2.5 text-sm shrink-0 cursor-pointer disabled:cursor-default disabled:opacity-40"
        >
          {busy ? '…' : 'Открыть'}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{ERROR_TEXT[error] ?? ERROR_TEXT.fail}</p>}
    </form>
  )
}
