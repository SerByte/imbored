'use client'

import { useLocale } from '@/components/LocaleProvider'
import { refundNote, REFUND_URL } from '@/lib/refund'
import { tr } from '@/lib/i18n'
import { Icon } from '@/components/Icon'

/**
 * Страховка покупки одной строкой — под ценой, а не рядом с кнопкой.
 *
 * Строка приглушённая намеренно: это ответ на «а если не зайдёт», который
 * человек задаёт себе сам, а не довод купить. Громче цены она читалась бы как
 * «купи и верни», а за такое Steam перестаёт возвращать деньги.
 *
 * Решение «показывать ли» здесь не принимается — только текст. Его принимает
 * сервер (refundEligible): там известны магазин, цена и дата выхода.
 * Компонент годится и серверной странице игры, и клиентским /play и /daily.
 * Клиентский он ради языка: useLocale() есть только у клиентского
 * компонента, а проп locale пришлось бы протянуть через каждого вызывающего.
 * В RSC-часть страницы игры уезжает один tone — от часов он не зависит.
 *
 * tone 'neutral' — для страницы игры: она публичная, совета купить на ней нет.
 */
export function RefundNote({
  tone = 'pick',
  className = '',
}: {
  tone?: 'pick' | 'neutral'
  className?: string
}) {
  const locale = useLocale()
  return (
    <p className={`text-xs text-faint leading-relaxed max-w-md ${className}`}>
      {refundNote(tone, locale)}{' '}
      <a
        href={REFUND_URL}
        target="_blank"
        rel="noreferrer"
        className="tap inline-flex items-center gap-1 text-dim underline-offset-2 transition-colors hover:text-ink hover:underline"
      >
        {tr(locale, { ru: 'Правила возврата', en: 'Refund policy' })}
        <Icon name="arrow" size={12} />
      </a>
    </p>
  )
}
