import { REFUND_NOTE, REFUND_NOTE_NEUTRAL, REFUND_URL } from '@/lib/refund'
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
 * Компонент без хуков, поэтому годится и серверной странице игры, и
 * клиентским /play и /daily.
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
  return (
    <p className={`text-xs text-faint leading-relaxed max-w-md ${className}`}>
      {tone === 'pick' ? REFUND_NOTE : REFUND_NOTE_NEUTRAL}{' '}
      <a
        href={REFUND_URL}
        target="_blank"
        rel="noreferrer"
        className="tap inline-flex items-center gap-1 text-dim underline-offset-2 transition-colors hover:text-ink hover:underline"
      >
        Правила возврата
        <Icon name="arrow" size={12} />
      </a>
    </p>
  )
}
