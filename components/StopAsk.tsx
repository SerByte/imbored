'use client'

import { AnimatePresence, m } from 'framer-motion'
import { useLocale } from '@/components/LocaleProvider'
import { Portal } from '@/components/Portal'
import { tr } from '@/lib/i18n'
import { EASE } from '@/lib/motion'

/**
 * «Не зацепило «X»?» — вторая половина правила остановки (lib/launchmemo.ts).
 *
 * Человек запустил игру с /play и спустя десять минут вернулся на вкладку.
 * Чаще всего это и есть ответ: зацепившая игра не отпускает к браузеру. Раньше
 * он находил перед собой ту же карточку, как будто ничего не было, и чтобы
 * получить другую, должен был сам догадаться нажать «Не то — дальше» у игры,
 * в которую только что играл. Теперь продукт спрашивает первым — теми же
 * причинами, что и у пропуска, — и выполняет обещание строки под кнопками:
 * «возвращайся, дадим другую».
 *
 * Плавающая плашка, а не полоса над героем, по той же причине, что у
 * WarmStrip: шапка fixed, а вопрос обязан быть виден, где бы ни стояла
 * прокрутка. Ничего не решает сам: уйти молча — «Закрыть».
 *
 * Тот же вопрос задаёт /daily про игру дня. Причин там нет — только «дай
 * другую», — поэтому строку под вопросом страница пишет сама (hint): «скажи,
 * что не так» над единственной кнопкой обещало бы выбор, которого нет.
 *
 * Строки — на языке страницы (useLocale), подсказка по умолчанию тоже;
 * подписи причин и свою подсказку вызывающий приносит уже на своём языке.
 */
export function StopAsk<K extends string>({
  game,
  reasons,
  hint,
  onReason,
  onHooked,
  onClose,
}: {
  game: { appid: number; name: string } | null
  reasons: ReadonlyArray<{ key: K; label: string }>
  hint?: string
  onReason: (key: K) => void
  onHooked: () => void
  onClose: () => void
}) {
  const locale = useLocale()
  return (
    <Portal>
      {/*
        Плашка приезжает порталом в конец <body> — туда, куда скринридер сам
        не дойдёт, пока не пролистает всю страницу. А появляется она без
        всякого действия с его стороны: человек просто вернулся на вкладку.
        Строка живёт всё время, пока смонтирована выдача, и оживает только
        вместе с вопросом — область, появившаяся одновременно с текстом, не
        звучит.
      */}
      <p role="status" className="sr-only">
        {game
          ? tr(locale, {
              ru: `Не зацепило «${game.name}»? Вопрос внизу экрана`,
              en: `“${game.name}” didn't hook you? The question is at the bottom of the screen`,
            })
          : ''}
      </p>
      <AnimatePresence>
        {game && (
          <m.div
            key={game.appid}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-6 z-40 flex justify-center px-safe pointer-events-none"
          >
            <section
              aria-label={tr(locale, { ru: 'Не зацепило?', en: "Didn't hook you?" })}
              className="panel-lift p-4 w-full max-w-xl flex flex-col gap-3 pointer-events-auto"
            >
              <div className="flex items-baseline justify-between gap-3">
                {/* По-английски игра встаёт первой — порядок слов свой, а не перевод кусков */}
                <p className="text-sm">
                  {tr(locale, {
                    ru: (
                      <>
                        Не зацепило <span className="text-ember-text">«{game.name}»</span>?
                      </>
                    ),
                    en: (
                      <>
                        <span className="text-ember-text">“{game.name}”</span> didn&apos;t hook you?
                      </>
                    ),
                  })}
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-3 py-1.5 text-xs text-faint hover:text-ink transition-colors cursor-pointer"
                >
                  {tr(locale, { ru: 'Закрыть', en: 'Close' })}
                </button>
              </div>
              <p className="-mt-2 text-xs text-dim">
                {hint ??
                  tr(locale, {
                    ru: 'Так бывает. Скажи, что не так, — дадим другую.',
                    en: "It happens. Tell us what's off and we'll find another.",
                  })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {reasons.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => onReason(r.key)}
                    className="pill"
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onHooked}
                  className="rounded-full bg-ember/15 text-ember-text px-4 py-2 text-sm cursor-pointer hover:bg-ember/20 transition-colors"
                >
                  {tr(locale, { ru: 'Зацепило', en: 'Hooked me' })}
                </button>
              </div>
            </section>
          </m.div>
        )}
      </AnimatePresence>
    </Portal>
  )
}
