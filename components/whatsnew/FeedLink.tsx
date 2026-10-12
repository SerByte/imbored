'use client'

import { useRef, useState, type ReactNode } from 'react'
import { ShareLinkInput, useShareLink } from '@/components/ShareLink'
import { StatusLine } from '@/components/StatusLine'
import { bounceTo, steamLoginFor } from '@/lib/destination'
import { issueReply } from '@/lib/feedlinkreply'
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
 * Что сейчас переспрашивается. issue — человек сам нажал «Выпустить новую»;
 * found — нажал «Получить ссылку», а сервер ответил, что ссылка уже есть
 * (409 exists): кнопка та же «Да, выпустить новую», но строка сначала
 * объясняет, откуда взялась ссылка, которой эта вкладка не видела.
 */
type Confirm = 'issue' | 'found' | 'off'

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
 * Есть ли ссылка, эта строка знает по первому кадру, а он бывает старым:
 * «назад» с патча достаёт /whatsnew из роутерного кэша, вторая вкладка
 * открыта до выпуска. Поэтому «Получить ссылку» без подтверждения просит
 * сервер выпустить, НЕ заменяя (replace: false), и на «уже есть» строка
 * показывает ту ссылку и переспрашивает. replace: true уходит только с
 * «Да, выпустить новую» — то есть после того, как человек видел, что рвёт.
 *
 * Строку «Отключается и кнопкой «Выйти на всех устройствах»» видит только
 * вошедший через Steam (verified): у демо такой кнопки нет (SignOut), и его
 * выход ссылку не трогает — обещать ему этот выключатель было бы враньём.
 *
 * !verified здесь и значит «демо»: строку рисует только пишущая сессия, а
 * пишет без verified одна демо-личность (isWriter в lib/server). Ей —
 * свои слова. Библиотека у неё чужая, и «патчи твоих игр», «видит, какие
 * игры у тебя есть» были неправдой. И ссылка живёт, пока жива личность:
 * уборка (sweepStale в lib/db) сносит демо через неделю без вестей — новый
 * демо-вход, продление сессии, оценка — и ссылку вместе с ним, а опросы
 * ридера вестями не считаются, и правильно: ридер держал бы брошенную
 * личность вечно. Выходит неделя-другая после последнего захода (продление
 * сессии отмечается не чаще раза в неделю) — и ровно это строка и говорит,
 * а рядом — вход через Steam, после которого лента своих игр. Выпуск демо не
 * закрыт: попробовать ленту в ридере — законная часть демо, если сказано,
 * сколько она проживёт. Поэтому «без захода сюда», правдивое у вошедшего
 * через Steam, демо не обещается: соседний абзац тут же говорит, что без
 * заходов ссылка умрёт, — его ссылка как раз от заходов и зависит.
 *
 * Буфер — общий useShareLink, но с what = null: без панели «Поделиться» и без
 * шага share_click. Эту ссылку не отправляют людям, её кладут в свой ридер;
 * а ?ref= у неё нет по той же причине — это ключ, а не приглашение.
 */
export function FeedLink({ since, verified }: { since: number | null; verified: boolean }) {
  const [phase, setPhase] = useState<Phase>(since === null ? { kind: 'off' } : { kind: 'on', since })
  const [busy, setBusy] = useState<'issue' | 'off' | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  /** Переспрашиваем про замену — с какого бы нажатия ни пришли */
  const asking = confirm === 'issue' || confirm === 'found'
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
    null,
    () => (phase.kind === 'shown' ? phase.url : ''),
    '',
    '',
    // Буфер закрыт обоими путями: адрес выделен — остаётся Ctrl+C
    () => {
      fieldRef.current?.focus()
      fieldRef.current?.select()
    },
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
          {/* Вход вернёт сюда же, к ссылке, а не на квиз (steamLoginFor) */}
          <a href={steamLoginFor('/whatsnew')} className="tap tap-tight underline underline-offset-4">
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
          {/*
            Вход вернёт сюда же, к ссылке, а не на квиз. Вошедшему через Steam
            — сразу Steam: 401 бывает и после «Выйти на всех устройствах» с
            другого устройства, и главная по тёплому кэшу сессии (минута,
            REVOKE_CACHE_SEC) встретила бы его как вошедшего и вернула к тому
            же 401, а свежий вход гасит старую сессию сам. Демо — через
            главную с возвратом: там и демо, и Steam, а в Steam он не входил.
            Обычный <a>, не Link: /api/auth/steam — роут, а не страница.
          */}
          <a
            href={verified ? steamLoginFor('/whatsnew') : bounceTo('/whatsnew')}
            className="tap tap-tight underline underline-offset-4"
          >
            войди снова
          </a>
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

  /** replace — человек подтвердил, что старая ссылка погаснет */
  async function issue(replace: boolean) {
    // Прежний отказ гаснет до запроса: второй такой же иначе промолчал бы
    // (components/StatusLine, REPEAT в lib/liveregion.test.ts)
    setMiss(null)
    setSaid('')
    setConfirm(null)
    setBusy('issue')
    try {
      const res = await fetch('/api/whatsnew/feedlink', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ replace }),
      })
      const reply = await issueReply(res)
      if (reply.kind === 'exists') {
        // Ссылка цела — эта вкладка её просто не видела. Показываем её и
        // переспрашиваем: кнопка та же, фокус на ней и остаётся
        setPhase({ kind: 'on', since: reply.since })
        setConfirm('found')
        return
      }
      const failure = await refusal(res)
      if (failure) {
        setMiss(failure)
        return
      }
      if (reply.kind !== 'shown') throw new Error('без пути')
      setPhase({ kind: 'shown', url: `${window.location.origin}${reply.path}` })
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
    // Ссылки нет, насколько видно отсюда, — спрашивать незачем. Но и рвать
    // вслепую нельзя: без replace сервер существующую не тронет (409 exists)
    if (phase.kind === 'off') {
      void issue(false)
      return
    }
    if (asking) {
      void issue(true)
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
        : asking
          ? 'Да, выпустить новую'
          : 'Выпустить новую'

  return (
    <section ref={homeRef} aria-labelledby="feedlink-title" className="flex flex-col gap-3 border-t border-rule pt-8">
      <h2 id="feedlink-title" className="font-display text-display-xs">
        RSS по секретной ссылке
      </h2>
      <p className="max-w-2xl text-sm leading-relaxed text-dim">
        {phase.kind === 'off'
          ? verified
            ? 'Патчи твоих игр — в ридер или телеграм-бот, без захода сюда. Ссылка личная: кто её знает, видит, какие игры у тебя есть, — не публикуй её.'
            : 'Патчи игр демо-библиотеки — в ридер или телеграм-бот.'
          : phase.kind === 'shown'
            ? 'Ссылка показывается один раз — сохрани её в ридере. Потеряешь — выпусти новую, старая перестанет работать.'
            : // dateLabel с годом кончается на «г.» — точка после него была бы второй
              `Ссылка выдана ${dateLabel(phase.since, { year: true })} — показать её снова нельзя: храним только отпечаток. Потерял — выпусти новую, старая перестанет работать.`}
      </p>
      {/* Срок демо-ссылки — при любой фазе: и до выпуска, и когда её кладут в ридер (докблок) */}
      {verified ? null : (
        <p className="max-w-2xl text-sm leading-relaxed text-dim">
          Ссылка живёт, пока жив демо-профиль: она перестанет работать через неделю-другую без заходов на
          сайт. Лента своих игр — после{' '}
          <a
            href={steamLoginFor('/whatsnew')}
            className="tap tap-tight font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
          >
            входа через Steam
          </a>
          .
        </p>
      )}

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
          confirm === 'found'
            ? 'Ссылка уже есть — выпущена раньше. Новая заменит её: старая перестанет работать, ридер придётся настроить заново.'
            : confirm === 'issue'
              ? 'Старая ссылка перестанет работать — ридер придётся настроить заново.'
              : confirm === 'off'
                ? 'Ридер перестанет получать ленту.'
                : null
        }
        className="text-sm text-ink"
      />
      <StatusLine text={miss} className="text-sm text-danger" />
      <StatusLine text={said} className="sr-only" />

      {verified && phase.kind !== 'off' ? (
        <p className="text-xs text-faint">Отключается и кнопкой «Выйти на всех устройствах».</p>
      ) : null}
    </section>
  )
}
