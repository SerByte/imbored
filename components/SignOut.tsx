'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { lazyIsland } from '@/components/lazyIsland'
import { StatusLine } from '@/components/StatusLine'
import { steamLoginFor } from '@/lib/destination'
import { focusAdrift } from '@/lib/focushandoff'
import { forgetPlay } from '@/lib/playforget'
import { timeHiddenStore } from '@/lib/playtime'
import { forgetSessionHint } from '@/lib/sessionhint'
import { signOutReply, type SignOutReply } from '@/lib/signoutreply'

/*
 * «Удалить всё обо мне» — отдельным чанком (components/lazyIsland), а не в
 * первой загрузке /library: она упирается в бюджет веса
 * (bundle-budget.json), а вопрос со списком и разбор ответов нужны одному
 * нажатию из тысячи. До гидратации кнопка всё равно ничего не умеет, а чанк
 * догружается сразу после неё — и только у входа через Steam: остальным
 * островок не монтируется вовсе.
 */
const ForgetMe = lazyIsland(() => import('@/components/ForgetMe').then((m) => m.ForgetMe), 'forget-me')

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
 *
 * Тем же правом стоит рядом «Удалить всё обо мне» (components/ForgetMe):
 * удаление тоже выпускает со всех устройств, и по ссылке на чужой профиль
 * стереть чужое нельзя. Поэтому строка о входе говорит про оба.
 *
 * «Везде» гасит и секретную ссылку на RSS-ленту (revokeAllSessions в
 * lib/db): ссылка — тоже доступ, выпущенный из сессии. Жмут же «везде» и
 * просто чтобы прибрать старые устройства, и тогда ридер или телеграм-бот
 * молча переставал бы получать патчи, а предупреждение стояло бы мелким
 * шрифтом на /whatsnew, где человека сейчас нет. Поэтому подтверждение
 * говорит об этом в момент нажатия — когда ссылка есть (feedLink): тому, у
 * кого её нет, лишняя оговорка про RSS только мешала бы понять вопрос.
 *
 * ОТВЕТ ЧИТАЕТСЯ (lib/signoutreply). «Везде» сервер может сделать не до
 * конца — база не записала отзыв или не прочла состояние сессии, — и тогда
 * кука погашена, а остальные входы и ссылка живы. Кнопка раньше уводила на
 * главную и в этом случае: человек, жавший «везде» из-за утечки, уходил
 * уверенным, что чужой отрезан. Теперь на месте кнопок — строка, что вышло
 * только здесь, и вход через Steam, после которого «везде» можно повторить:
 * без входа повторять нечем, кука уже погашена. На главную такая строка не
 * уводит, и refresh не зовётся: отрисованная заново /library развернула бы
 * вышедшего на лендинг вместе со строкой. Прежние кадры роутерного кэша
 * показали бы ему его же библиотеку — на его же устройстве.
 */
export function SignOut({ verified, feedLink = false }: { verified: boolean; feedLink?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'one' | 'all' | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  /** «Везде» сделано не до конца: это устройство вышло, и кнопки выхода ему больше ни к чему */
  const [partial, setPartial] = useState(false)
  const [miss, setMiss] = useState<ReactNode>(null)
  const homeRef = useRef<HTMLDivElement>(null)
  const retryRef = useRef<HTMLAnchorElement>(null)

  /*
   * Нажатая «Да, везде» уходит вместе с кнопками — фокус не должен упасть в
   * body: встаёт на вход, которым «везде» и повторяется. Только потерянный
   * (focusAdrift) — ушедший с кнопкой или ещё в блоке выхода.
   *
   * Эффектом, а не requestAnimationFrame в out(), как у «Отключить» в
   * FeedLink. Там цель стоит всегда, а здесь ссылка рождается этим же
   * обновлением. Оно пришло после await fetch, вне события, и React рендерит
   * его отдельной задачей планировщика: кадр, если он подоспел раньше, искал
   * бы ссылку, которой ещё нет, — и фокус падал бы в body вместе с кнопкой.
   * Эффект идёт после коммита: ссылка уже в DOM, кнопки уже нет.
   */
  useEffect(() => {
    if (partial && focusAdrift(document, homeRef.current)) retryRef.current?.focus()
  }, [partial])

  /*
   * Вопрос «везде?» встаёт на место нажатой кнопки, а «Отмена» уходит вместе
   * с ним: в обе стороны нажатый узел покидает DOM, и фокус падал в body —
   * клавиатура начинала со страницы сверху, а скринридер вопроса не слышал
   * вовсе, хотя в нём то, ради чего он задан: ссылка на RSS умрёт тоже. У
   * FeedLink подтверждение — та же кнопка, здесь — подмена (его докблок).
   *
   * Куда переносить, помнит отметка нажатия (handoff), а сам перенос — после
   * коммита, когда новый узел уже в DOM. Без отметки эффект сработал бы и на
   * монтировании: фокус там ещё в body, focusAdrift сказал бы «потерян», и
   * страница /library отняла бы его у начала документа. Переносится только
   * потерянный — как у входа для повтора выше.
   */
  const yesRef = useRef<HTMLButtonElement>(null)
  const allRef = useRef<HTMLButtonElement>(null)
  /** Нажатый узел ушёл с подменой: куда отдать фокус после коммита */
  const handoff = useRef<'yes' | 'all' | null>(null)
  useEffect(() => {
    const to = handoff.current
    handoff.current = null
    if (to && focusAdrift(document, homeRef.current)) (to === 'yes' ? yesRef : allRef).current?.focus()
  }, [confirmAll])
  /** Вопрос — описание «Да, везде»: фокус встаёт на неё, и вопрос звучит вместе с именем */
  const askId = useId()

  async function out(all: boolean) {
    if (busy !== null) return
    // Прежний отказ гаснет до запроса: второй такой же иначе промолчал бы
    // (components/StatusLine, REPEAT в lib/liveregion.test.ts)
    setMiss(null)
    setBusy(all ? 'all' : 'one')
    let reply: SignOutReply
    try {
      reply = await signOutReply(all, await fetch(`/api/auth/logout${all ? '?scope=all' : ''}`, { method: 'POST' }))
    } catch {
      reply = 'failed'
    }
    if (reply === 'failed') {
      // Кука гасится ответом сервера; если запрос не дошёл или ответил не
      // роут, уходить с экрана нечестно — вернём кнопки и дадим нажать снова.
      setBusy(null)
      setMiss('Не получилось выйти — нажми ещё раз.')
      return
    }
    // Забыть, что здесь кто-то был. Без этой строки выход уводит на главную,
    // а главная встречает вышедшего «С возвращением» — по подсказке, которую
    // никто не погасил.
    forgetSessionHint()
    // И выдачу /play, которую вкладка держит пятнадцать минут (lib/playcache,
    // стирает lib/playforget — без разбора выдачи в первой загрузке /library):
    // чужому входу её и так не покажут, но хранить подборку вышедшего незачем
    forgetPlay()
    // Его «время скрыто» (lib/playtime) — не про следующего на этом устройстве
    timeHiddenStore.set(null)
    if (reply === 'partial') {
      // Здесь вышел — кука погашена, и всё стёртое выше стёрто по праву. А
      // «везде» не сделано: сказать это и дать повторить (докблок выше)
      setPartial(true)
      setBusy(null)
      setMiss(
        <>
          Здесь ты вышел, а на остальных устройствах выйти не получилось
          {feedLink ? ' — и ссылка на RSS ещё работает' : ''}.{' '}
          {/* next=/library: вход вернёт сюда, к кнопке «везде» */}
          <a
            ref={retryRef}
            href={steamLoginFor('/library')}
            className="tap tap-tight text-ember-text underline decoration-1 underline-offset-2"
          >
            Войди через Steam
          </a>{' '}
          и нажми «Выйти на всех устройствах» ещё раз.
        </>,
      )
      // Фокус переезжает на вход эффектом выше — после того, как строка встанет
      return
    }
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
    <div ref={homeRef} className="mt-10 pt-6 border-t border-edge flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      {partial ? null : (
        <>
          <button
            type="button"
            onClick={() => void out(false)}
            aria-disabled={busy !== null}
            className="tap tap-tight text-dim hover:text-ink transition-colors aria-disabled:opacity-40 cursor-pointer"
          >
            {busy === 'one' ? 'Выхожу…' : 'Выйти'}
          </button>
          {confirmAll && verified ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-dim">
              <span id={askId}>
                {feedLink
                  ? 'Выйти на всех устройствах? Ссылка на RSS тоже перестанет работать.'
                  : 'Выйти на всех устройствах?'}
              </span>
              <button
                ref={yesRef}
                type="button"
                aria-describedby={askId}
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
                  handoff.current = 'all'
                }}
                aria-disabled={busy !== null}
                className="tap tap-tight hover:text-ink transition-colors cursor-pointer"
              >
                Отмена
              </button>
            </span>
          ) : verified ? (
            <button
              ref={allRef}
              type="button"
              onClick={() => {
                if (busy !== null) return
                setConfirmAll(true)
                handoff.current = 'yes'
              }}
              aria-disabled={busy !== null}
              className="tap tap-tight text-faint hover:text-ink transition-colors aria-disabled:opacity-40 cursor-pointer"
            >
              Выйти на всех устройствах
            </button>
          ) : (
            <span className="text-faint">
              Выход на всех устройствах и удаление данных — после{' '}
              {/* next=/library: после входа человек возвращается туда, где
                  нажимал, и кнопка «везде» уже на месте */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- ручка входа, а не страница: правило принимает /api за страницу из-за ловушки app/[lang]/[...missing] */}
              <a href="/api/auth/steam?next=%2Flibrary" className="tap tap-tight text-ember-text underline decoration-1 underline-offset-2">
                входа через Steam
              </a>
            </span>
          )}
          {/* Тем же правом, что «везде»: стереть всё по ссылке на чужой профиль
              нельзя, и сервер это проверяет сам (app/api/forget) */}
          {verified && <ForgetMe />}
        </>
      )}
      {/* Стоит всегда, меняется только текст (components/StatusLine): отказ
          звучит и при кнопках, и на их месте */}
      <StatusLine text={miss} className={partial ? 'basis-full text-dim' : 'basis-full text-danger'} />
    </div>
  )
}
