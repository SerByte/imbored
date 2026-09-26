'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { ShareLinkField, useShareLink } from '@/components/ShareLink'
import { pickShareUrl, type PickKind } from '@/lib/sharedpick'
import { isNeedSteam, writerStore } from '@/lib/writer'

type SharePickSource = {
  appid: number
  name: string
  source: string
  /** Подпись сервера (lib/pickshare); нет — выдача из кэша до этой правки, кнопки нет */
  share?: { text: string; sig: string }
}

type State =
  | { at: number; phase: 'busy' }
  | { at: number; phase: 'ready'; url: string }
  | { at: number; phase: 'failed'; message: string }

/**
 * «Отправить другу» у героя /play и /daily — ссылка /pick/<id>.
 *
 * Хук, а не компонент: кнопка стоит в ряду действий героя, а поле со
 * ссылкой — строкой под ним, и разнести их иначе пришлось бы общим
 * состоянием страницы. Состояние помнит, для какой игры оно (at): сменился
 * герой — кнопка снова чистая.
 *
 * Ссылка появляется только после ответа сервера, а системная панель и буфер
 * требуют свежего нажатия: после await iOS Safari отказывает обоим. Поэтому
 * после ответа попытка поделиться делается сразу — в Chrome и на Android
 * она проходит, — а поле со ссылкой показывается ВСЕГДА: в нём своя кнопка,
 * то есть второе, свежее нажатие.
 */
export function useSharePick(
  /** null — героя ещё нет: хук зовётся до ранних возвратов страницы */
  hero: SharePickSource | null | undefined,
  kind: PickKind,
): { button: ReactNode; panel: ReactNode } {
  const [state, setState] = useState<State | null>(null)
  const current = hero && state && state.at === hero.appid ? state : null
  const urlRef = useRef('')
  const title = `«${hero?.name ?? ''}» — imbored`
  const text = kind === 'daily' ? 'Моя игра дня от imbored' : 'imbored выбрал мне игру на вечер'
  const share = useShareLink(() => urlRef.current, title, text)

  if (!hero?.share) return { button: null, panel: null }
  const pick = hero
  const signed = hero.share

  async function create() {
    if (current?.phase === 'busy') return
    // Ссылка уже есть — просто поделиться ещё раз, свежим нажатием
    if (current?.phase === 'ready') {
      void share.run()
      return
    }
    const at = pick.appid
    setState({ at, phase: 'busy' })
    try {
      const res = await fetch('/api/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: at, source: pick.source, kind, text: signed.text, sig: signed.sig }),
      })
      if (await isNeedSteam(res)) {
        // Права кончились, пока страница была открыта: кнопки записи прячутся
        writerStore.set(false)
        setState(null)
        return
      }
      if (res.status === 429) {
        const min = Math.max(1, Math.ceil(Number(res.headers.get('Retry-After') ?? 60) / 60))
        setState({ at, phase: 'failed', message: `Слишком часто — попробуй через ${min} мин.` })
        return
      }
      if (res.status === 403) {
        setState({ at, phase: 'failed', message: 'Выдача устарела — обнови подборку и отправь снова.' })
        return
      }
      const data = (await res.json().catch(() => null)) as { id?: unknown } | null
      if (!res.ok || typeof data?.id !== 'string') throw new Error(String(res.status))
      const url = pickShareUrl(window.location.origin, data.id)
      urlRef.current = url
      setState({ at, phase: 'ready', url })
      void share.run()
    } catch {
      setState({ at, phase: 'failed', message: 'Не получилось сделать ссылку — нажми ещё раз.' })
    }
  }

  // Галочка — то же «Скопировано», что у поля: скопировал первый же нажим
  const button = (
    <>
      <button
        type="button"
        onClick={() => void create()}
        disabled={current?.phase === 'busy'}
        aria-busy={current?.phase === 'busy'}
        title="Отправить другу"
        className="btn-circle disabled:opacity-60"
      >
        <Icon name={share.state === 'done' ? 'check' : 'link'} size={20} />
        <span className="sr-only">Отправить другу</span>
      </button>
      {share.status}
    </>
  )

  const panel =
    current?.phase === 'ready' ? (
      <div className="flex w-full max-w-xl flex-col gap-1.5">
        <ShareLinkField
          url={current.url}
          label={`Ссылка на выбор «${pick.name}»`}
          title={title}
          text={text}
        />
        {/* Что уйдёт по ссылке — сказано тут же, а не только в политике */}
        <p className="text-xs text-faint">По ссылке видна игра и объяснение — без имени профиля.</p>
      </div>
    ) : current?.phase === 'failed' ? (
      <p role="status" className="-mt-1 text-sm text-danger">
        {current.message}
      </p>
    ) : null

  return { button, panel }
}
