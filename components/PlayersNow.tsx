'use client'

import type { ComponentProps } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { PlayersNow as PlayersNowView } from '@/components/PlayersNowView'

/**
 * Строка онлайна для клиентских экранов — тонкая обёртка над
 * components/PlayersNowView.
 *
 * Правила строки (свежесть замера, ноль, согласование «was/were») живут
 * там, в универсальном модуле с языком пропом: серверная страница игры
 * рисует её оттуда со своим toLocale(params.lang). Здесь — только язык:
 * герой /play и /daily и колода пати берут его из контекста корневого layout
 * (useLocale), и вызовы у них прежние. Разметка та же до байта — сторожит
 * lib/playersnow.test.ts.
 */
export function PlayersNow(props: Omit<ComponentProps<typeof PlayersNowView>, 'locale'>) {
  const locale = useLocale()
  return <PlayersNowView {...props} locale={locale} />
}
