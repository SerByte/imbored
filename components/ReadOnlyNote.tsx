'use client'

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { reportIslandFailure } from '@/components/lazyIsland'
import { peekReadOnlyNote, READONLY_NOTE_EVENT, takeReadOnlyNote } from '@/lib/readonlynote'

/** Привезённое тело записки: панель и то, что записка говорит скринридеру */
type Note = { Box: ComponentType<{ onHide: () => void }>; say: string }

/**
 * Записка «это режим просмотра» — оболочка в корневом лэйауте. Сама записка
 * (панель, Escape, уход от фокуса, «Войти через Steam») — в
 * components/ReadOnlyNoteBox и едет чанком, только когда её пора показать.
 *
 * ЗАЧЕМ ОБОЛОЧКА. Лэйаут — первая загрузка КАЖДОЙ страницы, а записка нужна
 * одному-единственному входу: по ссылке на профиль (lib/readonlynote).
 * Целиком она везла туда ~5 КБ — свою панель, адреса входа (lib/destination
 * ради steamLoginFor), перенос фокуса (lib/skiplink, lib/focushandoff) и
 * портал. Здесь остались флажок, событие и живая область. Что тело не
 * вернётся в лэйаут, сторожит lib/sharedchunk.test.ts.
 *
 * ФЛАЖОК — СПЕРВА ВЗГЛЯДОМ. Тело просят, только когда флажок стоит
 * (peekReadOnlyNote), а забирают флажок (takeReadOnlyNote), когда тело уже
 * приехало. Забери оболочка его раньше — чанк, не дошедший по дороге
 * (моргнула сеть, деплой сменил хеш), молча съел бы одноразовое сообщение.
 * Так он остаётся до следующей попытки: события или следующего документа —
 * но не дольше десяти минут (READONLY_NOTE_TTL_MS в lib/readonlynote).
 * Отказ — в отчёт, тем же путём и с тегом, что у островков
 * (reportIslandFailure): это то, что человек должен был увидеть.
 *
 * И ЗАБИРАЮТ ЕГО ПО ВЕРДИКТУ ТЕЛА (noteVerdict в components/ReadOnlyNoteBox):
 * пережив свой документ, флажок может дождаться возврата из «Войти через
 * Steam», и записка о просмотре досталась бы тому, кто уже пишет. Вердикт
 * спрашивает признак записи (lib/writer); сессия пишет — флажок забран, а
 * записки нет. Признак — в чанке тела: в лэйауте ему не место
 * (lib/sharedchunk.test.ts).
 *
 * ЖИВАЯ ОБЛАСТЬ — ЗДЕСЬ, а не в теле, и стоит в разметке с сервера, с первого
 * кадра. Тело вставляется в документ сразу показанным, и область в нём
 * рождалась бы вместе с текстом — такую зачитывает не каждая пара браузера и
 * скринридера (lib/liveregion.test.ts). Здесь текст приходит в область,
 * которая стояла задолго до него. Сама строка едет в чанке тела
 * (READONLY_SAY): кириллице в первой загрузке делать нечего.
 *
 * Записка встаёт на один круг до сервера позже, чем вставала, — это цена.
 *
 * Без портала: оболочка стоит в лэйауте снаружи обёртки смузера, и ей
 * трансформ не страшен. Панель тела — в своём портале, как и была.
 */
export function ReadOnlyNote() {
  const [note, setNote] = useState<Note | null>(null)

  useEffect(() => {
    // Оболочка живёт, пока жив документ; live — ради двойного монтирования в
    // разработке: флажок забирает только та копия, что осталась смонтированной
    let live = true
    // ждущий вердикт — один: следующая попытка сменяет прежнюю
    let waiting = () => {}
    const check = () => {
      if (!peekReadOnlyNote()) return
      import('./ReadOnlyNoteBox').then(
        (m) => {
          if (!live) return
          waiting()
          waiting = m.noteVerdict((show) => {
            if (live && takeReadOnlyNote() && show) setNote({ Box: m.ReadOnlyNoteBox, say: m.READONLY_SAY })
          })
        },
        (err: unknown) => reportIslandFailure('readonly-note', err),
      )
    }
    check()
    window.addEventListener(READONLY_NOTE_EVENT, check)
    return () => {
      live = false
      waiting()
      window.removeEventListener(READONLY_NOTE_EVENT, check)
    }
  }, [])

  const hide = useCallback(() => setNote(null), [])

  return (
    <>
      <p role="status" className="sr-only">
        {note ? note.say : ''}
      </p>
      {note && <note.Box onHide={hide} />}
    </>
  )
}
