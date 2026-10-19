'use client'

import { useLocale } from '@/components/LocaleProvider'
import { RefundNote as RefundNoteView } from '@/components/RefundNoteView'

/**
 * Строка о возврате для клиентских экранов (/play, /daily) — тонкая обёртка
 * над components/RefundNoteView: язык — из контекста корневого layout
 * (useLocale), разметка — та же до байта (lib/pricetag.test.ts). Серверная
 * страница игры зовёт саму RefundNoteView со своим языком.
 */
export function RefundNote(props: { tone?: 'pick' | 'neutral'; className?: string }) {
  const locale = useLocale()
  return <RefundNoteView {...props} locale={locale} />
}
