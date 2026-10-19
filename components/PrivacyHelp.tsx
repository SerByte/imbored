'use client'

import { useLocale } from '@/components/LocaleProvider'
import {
  PlaytimeHiddenNote as PlaytimeHiddenNoteView,
  PrivacyHelp as PrivacyHelpView,
  type PrivacyHelpProps,
} from '@/components/PrivacyHelpView'

/**
 * Панель скрытой библиотеки и строка о скрытом времени для клиентских
 * экранов — тонкая обёртка над components/PrivacyHelpView.
 *
 * Слова, шаги и кнопка проверки живут там, в универсальном модуле с языком
 * пропом: серверная /library рисует их оттуда со своим toLocale(params.lang),
 * и в её клиентский бандл они не едут. Здесь — только язык: /play, /daily,
 * /explore и карточка подключения берут его из контекста корневого layout
 * (useLocale), и вызовы у них прежние. Разметка та же до байта — сторожит
 * lib/privacyhelp.test.ts.
 *
 * Сама PrivacyHelp — без хуков, язык читает PrivacyPanel под ней: тест
 * панели зовёт её как функцию (lib/privacyhelp.test.ts), а хук вне рендера
 * React бросает. Без провайдера — русский, как было.
 */
export function PrivacyHelp(props: PrivacyHelpProps = {}) {
  return <PrivacyPanel {...props} />
}

function PrivacyPanel(props: PrivacyHelpProps) {
  const locale = useLocale()
  return <PrivacyHelpView {...props} locale={locale} />
}

export function PlaytimeHiddenNote(props: { className?: string }) {
  const locale = useLocale()
  return <PlaytimeHiddenNoteView {...props} locale={locale} />
}
