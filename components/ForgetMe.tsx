'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { StatusLine } from '@/components/StatusLine'
import { steamLoginFor } from '@/lib/destination'
import { focusAdrift } from '@/lib/focushandoff'
import { FORGET_CONFIRM, forgetPreviewReply, forgetReply, type ForgetMiss } from '@/lib/forgetreply'
import { markForgot } from '@/lib/forgotnotice'
import { forgetPlay } from '@/lib/playforget'
import { timeHiddenStore } from '@/lib/playtime'
import { forgetSessionHint } from '@/lib/sessionhint'

/** Что показал сервер перед удалением: что хранится и что случится вместе с ним */
type Asked = { items: string[]; effects: string[] }

/** Отказ — словами; повтор уместен только там, где он что-то изменит */
function missText(miss: ForgetMiss, step: 'ask' | 'erase'): ReactNode {
  if (miss === 'needsteam') {
    return (
      <>
        Удалить данные можно после{' '}
        {/* next=/library: вход вернёт сюда, к этой же кнопке */}
        <a
          href={steamLoginFor('/library')}
          className="tap tap-tight text-ember-text underline decoration-1 underline-offset-2"
        >
          входа через Steam
        </a>
        .
      </>
    )
  }
  if (miss === 'ratelimited') return 'Слишком много попыток с этого адреса — попробуй через час.'
  if (miss === 'gone') return 'Вход уже не действует — обнови страницу.'
  return step === 'ask'
    ? 'Не получилось узнать, что хранится, — нажми ещё раз.'
    : 'Не получилось удалить — нажми ещё раз.'
}

/**
 * «Удалить всё обо мне» — рядом с выходом на /library (components/SignOut).
 *
 * Раньше удалить данные можно было только письмом, и /privacy обещала ответ
 * за тридцать дней. Удаление то же самое (app/api/forget → forgetUser),
 * только сразу и без переписки.
 *
 * ТОЛЬКО ВХОДУ ЧЕРЕЗ STEAM. SignOut рисует кнопку лишь подтверждённой сессии,
 * сервер проверяет то же сам (needsteam), — по ссылке на чужой профиль
 * стереть чужое нельзя.
 *
 * ДВА ШАГА, И ВТОРОЙ — СО СПИСКОМ. Первое нажатие ничего не удаляет: оно
 * спрашивает сервер, что о человеке хранится, и показывает это списком
 * вместе с тем, что случится заодно (ссылки перестанут открываться, комнаты
 * закроются, выход на всех устройствах). Удаляет только «Да, удалить всё» под
 * этим списком. Вопрос встаёт ниже ряда кнопок, а не на месте нажатой:
 * второй щелчок двойного клика приходится в пустое место, а не в «Да».
 *
 * Фокус после вопроса — на «Отмене», а не на «Да», как у «Выйти везде?».
 * Выход можно повторить входом, удаление — нет: второй Enter, нажатый по
 * привычке, обязан попасть в безопасную кнопку. Вопрос — её описание
 * (aria-describedby), так что скринридер прочтёт список вместе с ней.
 * Переносится только потерянный фокус (focusAdrift): нажатый узел ушёл из
 * DOM, и без переноса клавиатура начинала бы со страницы сверху.
 *
 * После удаления — то же, что после выхода (SignOut, out): стереть подсказку
 * о входе, выдачу /play и «время скрыто» на этом устройстве — и на главную
 * со строкой «всё удалено» (components/landing/HeroNotice). Строку зажигает
 * метка в этой вкладке, которую главная забирает один раз
 * (lib/forgotnotice), а не адрес вроде /?forgot=1: тот жил бы в истории и
 * говорил «удалено» и вернувшемуся через месяц. Кука уже погашена ответом
 * сервера, остальные устройства — отметкой удаления.
 *
 * Кнопки на время запроса — aria-disabled, а не disabled
 * (lib/disabledfocus.test.ts); повтор гасят обработчики — по busy.
 */
export function ForgetMe() {
  const router = useRouter()
  const [busy, setBusy] = useState<'ask' | 'erase' | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  const [miss, setMiss] = useState<ReactNode>(null)
  const homeRef = useRef<HTMLDivElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  /** Нажатый узел ушёл с подменой: куда отдать фокус после коммита */
  const handoff = useRef<'cancel' | 'open' | null>(null)
  const askId = useId()

  useEffect(() => {
    const to = handoff.current
    handoff.current = null
    if (to && focusAdrift(document, homeRef.current)) (to === 'cancel' ? cancelRef : openRef).current?.focus()
  }, [asked])

  async function ask() {
    if (busy !== null) return
    // Прежний отказ гаснет до запроса: второй такой же иначе промолчал бы
    setMiss(null)
    setBusy('ask')
    let reply: Awaited<ReturnType<typeof forgetPreviewReply>>
    try {
      reply = await forgetPreviewReply(await fetch('/api/forget', { cache: 'no-store' }))
    } catch {
      reply = { kind: 'failed' }
    }
    setBusy(null)
    if (reply.kind !== 'ok') {
      setMiss(missText(reply.kind, 'ask'))
      return
    }
    handoff.current = 'cancel'
    setAsked({ items: reply.items, effects: reply.effects })
  }

  async function erase() {
    if (busy !== null) return
    setMiss(null)
    setBusy('erase')
    let reply: Awaited<ReturnType<typeof forgetReply>>
    try {
      reply = await forgetReply(
        await fetch('/api/forget', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: FORGET_CONFIRM }),
        }),
      )
    } catch {
      reply = 'failed'
    }
    if (reply !== 'done') {
      // Пачка удаления атомарна: отказ роута — не удалено ничего, и вопрос
      // со списком остаётся, чтобы нажать ещё раз
      setBusy(null)
      setMiss(missText(reply, 'erase'))
      return
    }
    // Здесь, как после выхода: следов прежнего входа на устройстве быть не
    // должно — главная иначе встретила бы «С возвращением»
    forgetSessionHint()
    forgetPlay()
    timeHiddenStore.set(null)
    // Строку «всё удалено» главная покажет по метке этой вкладки — один раз
    // (lib/forgotnotice), а не по адресу, который пережил бы удаление
    markForgot()
    // busy не снимается: кнопки остаются «Удаляю…», пока идёт переход.
    // refresh — после перехода, как у выхода: роутерный кэш помнит /library
    router.replace('/')
    router.refresh()
  }

  return (
    <div ref={homeRef} className="contents">
      {asked === null ? (
        <button
          ref={openRef}
          type="button"
          onClick={() => void ask()}
          aria-disabled={busy !== null}
          className="tap tap-tight text-faint hover:text-danger transition-colors aria-disabled:opacity-40 cursor-pointer"
        >
          {busy === 'ask' ? 'Смотрю, что хранится…' : 'Удалить всё обо мне'}
        </button>
      ) : (
        <div className="basis-full mt-2 flex flex-col gap-4 rounded-[var(--radius-card)] border border-edge p-4 leading-relaxed text-dim">
          <div id={askId} className="flex flex-col gap-3">
            <p className="font-medium text-ink">
              Удалить всё, что imbored о тебе хранит? Вернуть это будет нельзя.
            </p>
            <div className="flex flex-col gap-1.5">
              <p>Сейчас хранится:</p>
              <ul className="flex flex-col gap-1">
                {asked.items.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-faint" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-1.5">
              <p>Вместе с этим:</p>
              <ul className="flex flex-col gap-1">
                {asked.effects.map((effect) => (
                  <li key={effect} className="flex items-start gap-2.5">
                    <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-faint" />
                    {effect}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              onClick={() => void erase()}
              aria-disabled={busy !== null}
              className="tap tap-tight font-medium text-danger hover:brightness-110 transition aria-disabled:opacity-40 cursor-pointer"
            >
              {busy === 'erase' ? 'Удаляю…' : 'Да, удалить всё'}
            </button>
            <button
              ref={cancelRef}
              type="button"
              aria-describedby={askId}
              onClick={() => {
                if (busy !== null) return
                handoff.current = 'open'
                // отказ удаления — про вопрос, который закрыли
                setMiss(null)
                setAsked(null)
              }}
              aria-disabled={busy !== null}
              className="tap tap-tight hover:text-ink transition-colors aria-disabled:opacity-40 cursor-pointer"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
      {/* Стоит всегда, меняется только текст (components/StatusLine): отказ
          звучит и под кнопкой, и под вопросом */}
      <StatusLine text={miss} className="basis-full text-danger" />
    </div>
  )
}
