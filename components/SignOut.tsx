'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { forgetPlay } from '@/lib/playcache'
import { timeHiddenStore } from '@/lib/playtime'
import { forgetSessionHint } from '@/lib/sessionhint'

/**
 * Выход. Раньше его не было вовсе: сменить или сбросить вход можно было только
 * перезаписью куки через новый вход.
 *
 * Две кнопки, потому что случаи разные. «Выйти» гасит эту куку и эту сессию —
 * телефон при этом остаётся внутри. «На всех устройствах» нужен, когда доступ
 * мог утечь, и тогда он обязан достать даже те входы, о которых мы не знаем.
 *
 * Второй кнопки НЕТ у сессии, полученной по вставленной ссылке на профиль.
 * Она подписана, но владение ею не доказано (см. докблок Resolved.verified), а
 * «выйти везде» ставит users.sessions_from и гасит в том числе входы, сделанные
 * через Steam OpenID. Сервер это и так не выполнит — но предлагать кнопку,
 * которая сделает меньше обещанного, значит врать той же монетой.
 *
 * Вместо кнопки — строка о том, что для этого нужно. Она действенная: вход
 * через Steam доступен в один клик и даёт право сразу.
 */
export function SignOut({ verified }: { verified: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'one' | 'all' | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  async function out(all: boolean) {
    if (busy !== null) return
    setBusy(all ? 'all' : 'one')
    try {
      await fetch(`/api/auth/logout${all ? '?scope=all' : ''}`, { method: 'POST' })
    } catch {
      // Кука гасится ответом сервера; если запрос не дошёл, уходить с
      // экрана нечестно — вернём кнопки и дадим нажать снова.
      setBusy(null)
      return
    }
    // Забыть, что здесь кто-то был. Без этой строки выход уводит на главную,
    // а главная встречает вышедшего «С возвращением» — по подсказке, которую
    // никто не погасил.
    forgetSessionHint()
    // И выдачу /play, которую вкладка держит пятнадцать минут (lib/playcache):
    // чужому входу её и так не покажут, но хранить подборку вышедшего незачем
    forgetPlay()
    // Его «время скрыто» (lib/playtime) — не про следующего на этом устройстве
    timeHiddenStore.set(null)
    // refresh обязателен и идёт после перехода: страницы уже отрендерены с
    // прежней сессией, и без сброса роутерного кэша клиент показал бы их
    // из памяти — с библиотекой человека, который только что вышел.
    router.replace('/')
    router.refresh()
  }

  /*
   * Кнопки на время запроса — aria-disabled, а не disabled. Отказ сети
   * возвращает их (см. out), и нажатая обязана удержать фокус: disabled
   * выбрасывал его в body, и клавиатура после отказа начинала со страницы
   * сверху. Второе нажатие гасят обработчики — по busy.
   */
  return (
    <div className="mt-10 pt-6 border-t border-edge flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <button
        type="button"
        onClick={() => void out(false)}
        aria-disabled={busy !== null}
        className="tap tap-tight text-dim hover:text-ink transition-colors aria-disabled:opacity-40 cursor-pointer"
      >
        {busy === 'one' ? 'Выхожу…' : 'Выйти'}
      </button>
      {confirmAll && verified ? (
        <span className="flex items-center gap-3 text-dim">
          Выйти на всех устройствах?
          <button
            type="button"
            onClick={() => void out(true)}
            aria-disabled={busy !== null}
            className="tap tap-tight text-danger hover:brightness-110 transition aria-disabled:opacity-40 cursor-pointer"
          >
            {busy === 'all' ? 'Выхожу…' : 'Да, везде'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (busy !== null) return
              setConfirmAll(false)
            }}
            aria-disabled={busy !== null}
            className="tap tap-tight hover:text-ink transition-colors cursor-pointer"
          >
            Отмена
          </button>
        </span>
      ) : verified ? (
        <button
          type="button"
          onClick={() => {
            if (busy !== null) return
            setConfirmAll(true)
          }}
          aria-disabled={busy !== null}
          className="tap tap-tight text-faint hover:text-ink transition-colors aria-disabled:opacity-40 cursor-pointer"
        >
          Выйти на всех устройствах
        </button>
      ) : (
        <span className="text-faint">
          Выход на всех устройствах — после{' '}
          {/* next=/library: после входа человек возвращается туда, где
              нажимал, и кнопка «везде» уже на месте */}
          <a href="/api/auth/steam?next=%2Flibrary" className="tap tap-tight text-ember-text underline decoration-1 underline-offset-2">
            входа через Steam
          </a>
        </span>
      )}
    </div>
  )
}
