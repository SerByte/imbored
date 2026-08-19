'use client'

import { useCopy } from '@/components/useCopy'

/**
 * className и label — необязательные, со старыми значениями по умолчанию.
 *
 * На хабе это единственная кнопка и она главная, а на странице результата стоит
 * рядом с «Собрать пати вместе»: две ember-заливки подряд означали бы, что
 * действия равнозначны, хотя это не так.
 *
 * Копирование идёт через общий useCopy. Раньше здесь стояло
 * `void navigator.clipboard.writeText(link)` с безусловной галочкой — то есть
 * на небезопасном origin, при отказе в разрешении и в части мобильных
 * браузеров человек видел «Скопировано ✓», а в буфере было пусто. И это при
 * том, что вся фича «Совместимость» состоит ровно из одного действия: дать
 * другому человеку свою ссылку.
 */
export function CopyCompatLink({
  steamid,
  className = 'rounded-[14px] bg-ember text-on-ember font-semibold py-3 hover:brightness-110 transition cursor-pointer',
  label = 'Скопировать мою ссылку',
}: {
  steamid: string
  className?: string
  label?: string
}) {
  const { copied, failed, copy } = useCopy()
  const link = typeof window !== 'undefined' ? `${window.location.origin}/compat/${steamid}` : ''

  const button = (
    <button type="button" onClick={() => void copy(link)} className={className}>
      {copied ? 'Скопировано ✓' : label}
    </button>
  )

  /*
   * В обычном случае наружу уходит РОВНО кнопка, без обёртки.
   *
   * Компонент стоит в трёх местах с разными раскладками, и одно из них —
   * горизонтальный ряд CTA на странице результата (flex-wrap, gap-3). Там
   * кнопка сама является flex-элементом, и постоянная обёртка сдвинула бы ряд
   * у всех ради ветки, которая почти ни у кого не срабатывает.
   */
  if (!failed) return button

  // Запасной ход тот же, что в комнате: если буфер недоступен, ссылку всё
  // равно надо отдать в руки, а не сообщить о неудаче.
  return (
    <div className="flex flex-col gap-2">
      {button}
      <div className="flex flex-col gap-1.5 text-left">
        <span className="text-xs text-faint">Не вышло скопировать. Вот ссылка — забирай:</span>
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="rounded-[14px] bg-surface border border-edge px-4 py-2.5 text-sm font-mono text-dim w-full"
        />
      </div>
    </div>
  )
}
