'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { useLocale } from '@/components/LocaleProvider'
import { ShareLinkField, useShareLink } from '@/components/ShareLink'
import { StatusLine } from '@/components/StatusLine'
import { bounceTo } from '@/lib/destination'
import { lp, tr } from '@/lib/i18n'
import { pickShareUrl, type PickKind } from '@/lib/pickurl'
import { isNeedSteam, writerStore } from '@/lib/writer'

type SharePickSource = {
  appid: number
  name: string
  source: string
  /**
   * Подпись сервера (lib/pickshare); нет — выдача из кэша до этой правки, кнопки нет.
   * lang — язык текста под подписью: есть только у английского и уезжает
   * обратно в /api/pick, иначе подпись не сойдётся.
   */
  share?: { text: string; sig: string; lang?: 'en' }
}

type State =
  | { at: number; phase: 'busy' }
  /** counted — «Отправить другу» сам попробовал поделиться, и нажатие посчитано */
  | { at: number; phase: 'ready'; url: string; counted: boolean }
  | { at: number; phase: 'failed'; message: ReactNode }

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
 * то есть второе, свежее нажатие. Счётчик share:pick видит в нём второй шаг
 * того же намерения, а не новое «поделился» (counted у ShareLinkField):
 * иначе каждая отправка с iOS ложилась бы в него дважды.
 *
 * Ответ сервера может прийти, когда на экране уже другая игра: «Не то —
 * дальше» и «Сегодня хочу из своего» не ждут запроса. Тогда он не трогает
 * ни чужое состояние, ни буфер — иначе ссылка на прежнюю игру ушла бы в
 * буфер под галочкой на кнопке новой.
 *
 * Ссылка — на языке страницы (/en/pick/… на /en), текст — на языке своей
 * подписи (share.lang). Выдачу собирает сервер на языке запроса, так что оба
 * совпадают; язык текста хранит и сама запись выбора (shared_picks.lang).
 */
export function useSharePick(
  /** null — героя ещё нет: хук зовётся до ранних возвратов страницы */
  hero: SharePickSource | null | undefined,
  kind: PickKind,
): { button: ReactNode; panel: ReactNode } {
  const locale = useLocale()
  const [state, setState] = useState<State | null>(null)
  const current = hero && state && state.at === hero.appid ? state : null
  const urlRef = useRef('')
  // Какой герой на экране сейчас — для ответа, пришедшего после смены героя
  const shownRef = useRef<number | null>(null)
  useEffect(() => {
    shownRef.current = hero?.appid ?? null
  }, [hero?.appid])
  const title = tr(locale, { ru: `«${hero?.name ?? ''}» — imbored`, en: `“${hero?.name ?? ''}” — imbored` })
  const text =
    kind === 'daily'
      ? tr(locale, { ru: 'Моя игра дня от imbored', en: 'My game of the day from imbored' })
      : tr(locale, { ru: 'imbored выбрал мне игру на вечер', en: 'imbored picked my game for tonight' })
  const share = useShareLink('pick', () => urlRef.current, title, text)

  if (!hero?.share) return { button: null, panel: null }
  const pick = hero
  const signed = hero.share

  async function create() {
    if (current?.phase === 'busy') return
    // Ссылка уже есть — просто поделиться ещё раз, свежим нажатием
    if (current?.phase === 'ready') {
      urlRef.current = current.url
      void share.run()
      return
    }
    const at = pick.appid
    // Ответ пишет только в своё состояние: пока шёл запрос, у кнопки мог
    // смениться герой, и его состояние чужой ответ не трогает
    const settle = (next: State | null) => setState((s) => (s && s.at !== at ? s : next))
    setState({ at, phase: 'busy' })
    try {
      // Без withLang: роут отвечает одним id, без текста для человека, а язык
      // текста едет в теле рядом с подписью, которая его и покрывает
      const res = await fetch('/api/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appid: at,
          source: pick.source,
          kind,
          text: signed.text,
          sig: signed.sig,
          // Язык подписан вместе с текстом: у русского поля нет, как до английской версии
          ...(signed.lang ? { lang: signed.lang } : {}),
        }),
      })
      if (await isNeedSteam(res)) {
        // Права кончились, пока страница была открыта: кнопки записи прячутся
        writerStore.set(false)
        settle(null)
        return
      }
      if (res.status === 401) {
        // Вход кончился (выход в другой вкладке, истёк срок) — «нажми ещё
        // раз» здесь не помогло бы никогда
        settle({
          at,
          phase: 'failed',
          // Голый <a> префикса языка сам не поставит: bounceTo берёт язык из
          // пути, поэтому путь — уже на языке страницы
          message: tr(locale, {
            ru: (
              <>
                Вход закончился —{' '}
                <a
                  href={bounceTo(kind === 'daily' ? '/daily' : '/play')}
                  className="tap tap-tight underline underline-offset-4"
                >
                  войди снова
                </a>
                , и ссылка сделается.
              </>
            ),
            en: (
              <>
                You&apos;re signed out —{' '}
                <a
                  href={bounceTo(lp(locale, kind === 'daily' ? '/daily' : '/play'))}
                  className="tap tap-tight underline underline-offset-4"
                >
                  sign in again
                </a>{' '}
                and we&apos;ll make the link.
              </>
            ),
          }),
        })
        return
      }
      if (res.status === 429) {
        const min = Math.max(1, Math.ceil(Number(res.headers.get('Retry-After') ?? 60) / 60))
        settle({
          at,
          phase: 'failed',
          message: tr(locale, {
            ru: `Слишком часто — попробуй через ${min} мин.`,
            en: `Too many tries — try again in ${min} min.`,
          }),
        })
        return
      }
      if (res.status === 403) {
        settle({
          at,
          phase: 'failed',
          message: tr(locale, {
            ru: 'Выдача устарела — обнови подборку и отправь снова.',
            en: 'These picks are out of date — refresh them and send again.',
          }),
        })
        return
      }
      const data = (await res.json().catch(() => null)) as { id?: unknown } | null
      if (!res.ok || typeof data?.id !== 'string') throw new Error(String(res.status))
      const url = pickShareUrl(window.location.origin, data.id, locale)
      // Герой сменился, пока шёл запрос: в буфер ссылку не кладём молча —
      // вернётся к этой игре, нажмёт, и ссылка уже будет готова. И не
      // считаем: первым «поделился» тогда станет нажатие в поле (counted)
      const shown = shownRef.current === at
      settle({ at, phase: 'ready', url, counted: shown })
      if (!shown) return
      urlRef.current = url
      void share.run()
    } catch {
      settle({
        at,
        phase: 'failed',
        message: tr(locale, {
          ru: 'Не получилось сделать ссылку — нажми ещё раз.',
          en: "Couldn't make the link — try again.",
        }),
      })
    }
  }

  const busy = current?.phase === 'busy'
  const button = (
    <>
      {/*
        aria-disabled, а не disabled: отключённая кнопка теряет фокус, и
        клавиатура после ответа начинала бы с начала страницы, а не рядом с
        полем ссылки (тот же довод, что у «Не сегодня» на /daily). Повтор
        нажатия и так гасит create.
      */}
      <button
        type="button"
        onClick={() => void create()}
        aria-disabled={busy}
        aria-busy={busy}
        title={tr(locale, { ru: 'Отправить другу', en: 'Send to a friend' })}
        className="btn-circle aria-disabled:opacity-60"
      >
        {/* Галочка — «Скопировано» этой игры, а не отклик прошлой */}
        <Icon name={share.state === 'done' && current?.phase === 'ready' ? 'check' : 'link'} size={20} />
        <span className="sr-only">{tr(locale, { ru: 'Отправить другу', en: 'Send to a friend' })}</span>
      </button>
      {share.status}
    </>
  )

  /*
   * Отказ — в строке, которая стоит всегда, пока у героя есть кнопка: пустая,
   * пока ссылку не просили, и create переводит её в «busy» (пусто) перед
   * каждой попыткой — так что отказ приходит изменением текста и прозвучит.
   * Ветвью рядом с полем ссылки она рождалась бы вместе с текстом, а такую
   * живую область скринридер объявляет не везде (components/StatusLine).
   */
  const panel = (
    <>
      {current?.phase === 'ready' && (
        <div className="flex w-full max-w-xl flex-col gap-1.5">
          {/*
            counted: первое нажатие поля — второй шаг уже посчитанного «Отправить
            другу» (на iOS без него ссылка не уйдёт), а не новое «поделился».
            key — по адресу: новой ссылке героя — новое поле со своим первым
            нажатием, а не израсходованное прежней (components/ShareLink).
          */}
          <ShareLinkField
            key={current.url}
            counted={current.counted}
            what="pick"
            url={current.url}
            label={tr(locale, { ru: `Ссылка на выбор «${pick.name}»`, en: `Link to the pick “${pick.name}”` })}
            title={title}
            text={text}
          />
          {/* Что уйдёт по ссылке — сказано тут же, а не только в политике */}
          <p className="text-xs text-faint">
            {tr(locale, {
              ru: 'По ссылке — игра и это объяснение, как здесь, но без имени профиля.',
              en: 'The link shows the game and this explanation, as here, but not your profile name.',
            })}
          </p>
        </div>
      )}
      <StatusLine
        text={current?.phase === 'failed' ? current.message : null}
        className="-mt-1 text-sm text-danger"
      />
    </>
  )

  return { button, panel }
}
