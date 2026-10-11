'use client'

import Link from 'next/link'
import { useRef, useState, type ReactNode } from 'react'
import { ShareLinkInput, useShareLink } from '@/components/ShareLink'
import { StatusLine } from '@/components/StatusLine'
import { focusAdrift } from '@/lib/focushandoff'
import { dateLabel } from '@/lib/freshness'
import { isNeedSteam, writerStore } from '@/lib/writer'

type Phase =
  /** Ссылки нет: не выпускали или отключили */
  | { kind: 'off' }
  /** Ссылка есть, но показать её нельзя — в базе только отпечаток */
  | { kind: 'on'; since: number }
  /** Только что выпущена: адрес виден один раз, до ухода со страницы */
  | { kind: 'shown'; url: string }

/**
 * «RSS по секретной ссылке» внизу /whatsnew: выпустить, скопировать,
 * перевыпустить, отключить. Сама лента — app/whatsnew/feed/[token].
 *
 * Стоит только у пишущей сессии — это решает страница (isWriter): ключ даёт
 * постоянный доступ к ленте патчей твоих игр, и выпускать его тому, кто
 * владения профилем не доказал, нельзя (app/api/whatsnew/feedlink).
 *
 * АДРЕС ВИДЕН ОДИН РАЗ. Сервер хранит sha256 ключа и показать ссылку снова
 * не может; страница честно так и говорит, а вместо «показать» предлагает
 * выпустить новую. Адрес собирается от window.location.origin — см. feedPath.
 *
 * ПЕРЕВЫПУСК И ОТКЛЮЧЕНИЕ — с подтверждением: оба рвут подписку в ридере, и
 * случайное нажатие стоило бы человеку заново настраивать бота. Подтверждение
 * — та же кнопка со словом «Да»: нажатая кнопка остаётся в DOM, и фокус с
 * неё никуда не падает (у SignOut подтверждение подменяет кнопку целиком).
 *
 * Буфер — общий useShareLink, но copyOnly: без панели «Поделиться» и без
 * шага share_click. Эту ссылку не отправляют людям, её кладут в свой ридер;
 * а ?ref= у неё нет по той же причине — это ключ, а не приглашение.
 */
export function FeedLink({ since }: { since: number | null }) {
  const [phase, setPhase] = useState<Phase>(since === null ? { kind: 'off' } : { kind: 'on', since })
  const [busy, setBusy] = useState<'issue' | 'off' | null>(null)
  const [confirm, setConfirm] = useState<'issue' | 'off' | null>(null)
  const [miss, setMiss] = useState<ReactNode>(null)
  /**
   * Что сказать скринридеру об удаче. Отказы звучат своей строкой, а удача
   * иначе прошла бы молча: поле со ссылкой появляется, но появление — не
   * объявление. Гаснет в начале каждой попытки — повтор звучит.
   */
  const [said, setSaid] = useState('')
  const homeRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const share = useShareLink(
    () => (phase.kind === 'shown' ? phase.url : ''),
    '',
    '',
    // Буфер закрыт обоими путями: адрес выделен — остаётся Ctrl+C
    () => {
      fieldRef.current?.focus()
      fieldRef.current?.select()
    },
    { copyOnly: true },
  )

  /** Отказ сервера словами — или null, если ответ удачный */
  async function refusal(res: Response): Promise<ReactNode> {
    if (await isNeedSteam(res)) {
      // Права кончились, пока страница была открыта: остальные кнопки записи
      // на других островках узнают это из того же хранилища
      writerStore.set(false)
      return (
        <>
          Ссылку выпускает вошедший через Steam —{' '}
          <a href="/api/auth/steam" className="tap tap-tight underline underline-offset-4">
            войди
          </a>
          .
        </>
      )
    }
    if (res.status === 401) {
      return (
        <>
          Вход закончился —{' '}
          <Link href="/" className="tap tap-tight underline underline-offset-4">
            войди снова
          </Link>
          .
        </>
      )
    }
    if (res.status === 429) {
      const min = Math.max(1, Math.ceil(Number(res.headers.get('Retry-After') ?? 60) / 60))
      return `Слишком часто — попробуй через ${min} мин.`
    }
    return res.ok ? null : 'Не получилось — нажми ещё раз.'
  }

  async function issue() {
    // Прежний отказ гаснет до запроса: второй такой же иначе промолчал бы
    // (components/StatusLine, REPEAT в lib/liveregion.test.ts)
    setMiss(null)
    setSaid('')
    setConfirm(null)
    setBusy('issue')
    try {
      const res = await fetch('/api/whatsnew/feedlink', { method: 'POST' })
      const failure = await refusal(res)
      if (failure) {
        setMiss(failure)
        return
      }
      const data = (await res.json().catch(() => null)) as { path?: unknown } | null
      if (typeof data?.path !== 'string') throw new Error('без пути')
      setPhase({ kind: 'shown', url: `${window.location.origin}${data.path}` })
      setSaid('Ссылка готова — она в поле выше и показывается один раз.')
    } catch {
      setMiss('Не получилось — нажми ещё раз.')
    } finally {
      setBusy(null)
    }
  }

  async function disable() {
    setMiss(null)
    setSaid('')
    setConfirm(null)
    setBusy('off')
    try {
      const res = await fetch('/api/whatsnew/feedlink', { method: 'DELETE' })
      const failure = await refusal(res)
      if (failure) {
        setMiss(failure)
        return
      }
      setPhase({ kind: 'off' })
      setSaid('Ссылка отключена.')
      // «Отключить» уходит вместе со ссылкой — фокус с неё не должен упасть
      // в body: встаёт на главную кнопку, которая теперь «Получить ссылку»
      requestAnimationFrame(() => {
        if (focusAdrift(document, homeRef.current)) primaryRef.current?.focus()
      })
    } catch {
      setMiss('Не получилось — нажми ещё раз.')
    } finally {
      setBusy(null)
    }
  }

  function onPrimary() {
    if (busy !== null) return
    // Ссылки нет — рвать нечего, спрашивать незачем
    if (phase.kind === 'off' || confirm === 'issue') {
      void issue()
      return
    }
    setMiss(null)
    setConfirm('issue')
  }

  function onOff() {
    if (busy !== null) return
    if (confirm === 'off') {
      void disable()
      return
    }
    setMiss(null)
    setConfirm('off')
  }

  function onCancel() {
    if (busy !== null) return
    setConfirm(null)
    // «Отмена» уходит, нажатая, — фокус возвращается к главной кнопке
    primaryRef.current?.focus()
  }

  const primaryLabel =
    busy === 'issue'
      ? 'Выпускаю…'
      : phase.kind === 'off'
        ? 'Получить ссылку'
        : confirm === 'issue'
          ? 'Да, выпустить новую'
          : 'Выпустить новую'

  return (
    <section ref={homeRef} aria-labelledby="feedlink-title" className="flex flex-col gap-3 border-t border-rule pt-8">
      <h2 id="feedlink-title" className="font-display text-display-xs">
        RSS по секретной ссылке
      </h2>
      <p className="max-w-2xl text-sm leading-relaxed text-dim">
        {phase.kind === 'off'
          ? 'Патчи твоих игр — в ридер или телеграм-бот, без захода сюда. Ссылка личная: кто её знает, видит, какие игры у тебя есть, — не публикуй её.'
          : phase.kind === 'shown'
            ? 'Ссылка показывается один раз — сохрани её в ридере. Потеряешь — выпусти новую, старая перестанет работать.'
            : // dateLabel с годом кончается на «г.» — точка после него была бы второй
              `Ссылка выдана ${dateLabel(phase.since, { year: true })} — показать её снова нельзя: храним только отпечаток. Потерял — выпусти новую, старая перестанет работать.`}
      </p>

      {phase.kind === 'shown' ? (
        <div className="join is-link max-w-2xl">
          <ShareLinkInput url={phase.url} label="Секретная ссылка на RSS-ленту" inputRef={fieldRef} />
          <button
            type="button"
            onClick={() => void share.run()}
            className="btn-ember is-block whitespace-nowrap px-5"
          >
            {share.label('Скопировать', { manual: 'Скопируй вручную' })}
          </button>
        </div>
      ) : null}
      {/* «Скопировано» для скринридера — стоит всегда, не только при поле */}
      {share.status}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {/*
          aria-disabled, а не disabled: кнопка на время запроса держит фокус
          (lib/disabledfocus.test.ts), повтор гасят обработчики — по busy.
        */}
        <button
          ref={primaryRef}
          type="button"
          onClick={onPrimary}
          aria-disabled={busy !== null}
          className="tap tap-tight cursor-pointer font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70 aria-disabled:opacity-40"
        >
          {primaryLabel}
        </button>
        {phase.kind !== 'off' ? (
          <button
            type="button"
            onClick={onOff}
            aria-disabled={busy !== null}
            className="tap tap-tight cursor-pointer text-dim transition-colors hover:text-ink aria-disabled:opacity-40"
          >
            {busy === 'off' ? 'Отключаю…' : confirm === 'off' ? 'Да, отключить' : 'Отключить'}
          </button>
        ) : null}
        {confirm !== null ? (
          <button
            type="button"
            onClick={onCancel}
            aria-disabled={busy !== null}
            className="tap tap-tight cursor-pointer text-dim transition-colors hover:text-ink aria-disabled:opacity-40"
          >
            Отмена
          </button>
        ) : null}
      </div>

      {/* Обе строки стоят всегда — меняется только текст (components/StatusLine) */}
      <StatusLine
        text={
          confirm === 'issue'
            ? 'Старая ссылка перестанет работать — ридер придётся настроить заново.'
            : confirm === 'off'
              ? 'Ридер перестанет получать ленту.'
              : null
        }
        className="text-sm text-ink"
      />
      <StatusLine text={miss} className="text-sm text-danger" />
      <StatusLine text={said} className="sr-only" />

      {phase.kind !== 'off' ? (
        <p className="text-xs text-faint">Отключается и кнопкой «Выйти на всех устройствах».</p>
      ) : null}
    </section>
  )
}
