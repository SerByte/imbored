'use client'

import { Icon } from '@/components/Icon'
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { MotionMax } from '@/components/motion/MotionMax'
import { focusAdrift } from '@/lib/focushandoff'
import type { RoomMemberView } from '@/lib/room'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Кто в комнате и кто где застрял.
 *
 * Опрос и раньше приносил голоса всех участников каждые 2.5 секунды — экран
 * ожидания не показывал из них ничего и спрашивал «ждём остальных» в пустоту.
 * Здесь ровно те же данные, но в виде ответа на единственный вопрос, который
 * у человека есть: почему я всё ещё тут.
 *
 * Полоса — тот же объект, что прогресс колоды в SwipeDeck (bg-track + bg-ember,
 * 0.3s, тот же EASE): человек только что смотрел на неё двадцать карт подряд.
 */
export function MemberRoster({
  members,
  deckSize,
  hint = null,
  isHost = false,
  onRemove,
  removing = false,
}: {
  members: RoomMemberView[]
  deckSize: number | null
  /** строка под списком — rosterHint из lib/room; null — без строки */
  hint?: string | null
  /** хост может убрать застрявшего — см. app/api/room/[id]/leave */
  isHost?: boolean
  onRemove?: (memberId: string) => void
  /** запрос выхода или удаления в пути — повтор гасит removeMember на странице */
  removing?: boolean
}) {
  const reduce = useReducedMotion()
  const doneCount = members.filter((member) => member.done).length

  /*
   * ✕ УНОСИТ ФОКУС ВМЕСТЕ СО СТРОКОЙ.
   *
   * Кнопка стоит в строке того, кого убирают: после успеха опрос его уже не
   * приносит, AnimatePresence уводит строку, и фокус падал в body — хост с
   * клавиатуры, убрав одного застрявшего, начинал со страницы сверху. Теперь
   * перед удалением запоминается, кому фокус достанется: ✕ следующей строки,
   * иначе предыдущей, иначе заголовок «Кто где». Отдаётся он, когда строки
   * действительно не стало, и только потерянный (focusAdrift): уходящая
   * строка ещё в списке на время выхода, поэтому фокус в ней — тоже потерян.
   * Отказ оставляет строку и фокус на её ✕ — тогда перенос просто забывается.
   *
   * Убрали последнего, кроме себя, — список уходит целиком вместе с режимом;
   * фокус тогда забирает заголовок нового режима (смена режима в RoomWaiting).
   */
  const headRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const removeButtons = useRef(new Map<string, HTMLButtonElement>())
  const handoff = useRef<{ gone: string; to: string | null } | null>(null)

  useEffect(() => {
    const h = handoff.current
    if (!h) return
    if (members.some((member) => member.id === h.gone)) {
      if (!removing) handoff.current = null
      return
    }
    handoff.current = null
    if (!focusAdrift(document, listRef.current)) return
    const next = h.to ? removeButtons.current.get(h.to) : undefined
    ;(next ?? headRef.current)?.focus()
  }, [members, removing])

  const remove = (id: string) => {
    if (removing || !onRemove) return
    const others = members.filter((member) => !member.me)
    const at = others.findIndex((member) => member.id === id)
    handoff.current = { gone: id, to: others[at + 1]?.id ?? others[at - 1]?.id ?? null }
    onRemove(id)
  }

  return (
    <div className="relative panel-lift p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 ref={headRef} tabIndex={-1} className="font-display text-display-xs">
          Кто где
        </h2>
        <span aria-hidden className="text-xs text-faint tabular-nums shrink-0">
          {doneCount}/{members.length}
        </span>
      </div>

      {/* layout — фича domMax, её догружает MotionMax */}
      <MotionMax>
        <ul ref={listRef} className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {members.map((member) => {
              // Голосов может оказаться больше, чем карт: колода пересобирается
              // при входе нового человека, а голоса по старой уже записаны
              const shown = deckSize ? Math.min(member.votes, deckSize) : member.votes
              const pct = deckSize ? Math.min(100, (member.votes / deckSize) * 100) : 0

              return (
                <m.li
                  key={member.id}
                  // MotionConfig reducedMotion="user" не отключает layout-анимации,
                  // поэтому гасим их здесь же — иначе строки продолжат ездить
                  layout={!reduce}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="flex items-center gap-3"
                >
                  <span aria-hidden className="w-4 shrink-0 flex justify-center">
                    {member.done ? (
                      <Icon name="check" size={14} className="text-ok" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
                    )}
                  </span>

                  {/*
                    aria-hidden, потому что полную фразу про этого участника
                    говорит sr-only ниже. Без этого каждая строка звучала дважды:
                    «Дима (ты)» и следом «Дима (ты): 5 из 20, ещё свайпает» — в
                    комнате на четверых четыре сдвоенных имени подряд, ровно на
                    экране, который слушают в ожидании матча. Все остальные
                    видимые части строки уже скрыты по той же причине.

                    title остаётся: он для глаза, когда имя обрезано.
                  */}
                  <span
                    aria-hidden
                    title={member.name}
                    className={`w-[5.5rem] sm:w-40 shrink-0 truncate text-sm ${
                      member.me ? 'text-ink font-semibold' : 'text-dim'
                    }`}
                  >
                    {member.name}
                    {member.me ? ' (ты)' : ''}
                  </span>

                  <span
                    aria-hidden
                    className="h-1 flex-1 min-w-[3rem] rounded-full bg-track overflow-hidden"
                  >
                    <m.span
                      className="block h-full rounded-full bg-ember"
                      initial={false}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.3, ease: EASE }}
                    />
                  </span>

                  {/*
                    .anim-pulse-dot выключается в prefers-reduced-motion, поэтому
                    «свайпает» и «всё» не имеют права держаться на движении.
                    Различает их ФОРМА — галочка против точки, — она работает
                    всегда и на любой ширине. Слово рядом это подтверждает, но
                    на мобиле уезжает: там строка и так плотная, а смысл уже несут
                    галочка и число. Полная фраза — в sr-only ниже.

                    Слова без рода. «Готов» и «закончил» рядом с чужим ником
                    выходили «Аня · готов» — ровно то, что LikesStrips называет
                    ошибкой («Аня сошёлся»): род по нику из Steam не узнать.
                  */}
                  <span aria-hidden className="text-xs text-faint shrink-0 hidden sm:inline">
                    {member.done ? 'всё' : 'свайпает'}
                  </span>
                  <span aria-hidden className="text-xs text-faint tabular-nums shrink-0">
                    {deckSize ? `${shown}/${deckSize}` : shown}
                  </span>

                  {/*
                    Рука хоста. Знаменатель единогласия — число участников, и
                    вошедший, который закрыл вкладку, запирал комнату навсегда:
                    сам он уже ничего не нажмёт.

                    Только у чужих строк и только у хоста. Себя он убирает
                    общей ссылкой ниже — там же, где все.
                  */}
                  {isHost && !member.me && onRemove ? (
                    <button
                      type="button"
                      ref={(el) => {
                        if (!el) return
                        removeButtons.current.set(member.id, el)
                        return () => {
                          removeButtons.current.delete(member.id)
                        }
                      }}
                      onClick={() => remove(member.id)}
                      // aria-disabled, а не disabled: фокус остаётся на ✕, пока
                      // запрос в пути, а на отказе — и после (строку отказа
                      // пишет RoomWaiting внизу экрана)
                      aria-disabled={removing}
                      title={`Убрать ${member.name} из пати`}
                      aria-label={`Убрать ${member.name} из пати`}
                      className="tap tap-tight shrink-0 -my-1.5 px-1.5 py-1.5 text-xs text-faint hover:text-danger transition-colors cursor-pointer aria-disabled:opacity-40"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  ) : null}

                  <span className="sr-only">
                    {member.name}
                    {member.me ? ' (ты)' : ''}: {shown}
                    {deckSize ? ` из ${deckSize}` : ''}, {member.done ? 'колода пройдена' : 'ещё свайпает'}
                  </span>
                </m.li>
              )
            })}
          </AnimatePresence>
        </ul>
      </MotionMax>

      {/* Строка приходит снаружи: безусловное «Матч появится сам» стояло и под
          «ни разу не совпали», и при пустой колоде — см. rosterHint */}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  )
}
