'use client'

import { m } from 'framer-motion'
import type { ComponentProps } from 'react'
import { trackCardDownload, type CardKind } from '@/lib/track'

/**
 * «Скачать карточку» у портрета и итогов года — ссылка на card.png с
 * download, которая отмечает нажатие шагом воронки card_download (lib/track).
 *
 * Карточка — второй путь поделиться, кроме ссылки: её кидают в чат и в
 * сторис картинкой. Ссылку считала кнопка (useShareLink), а скачивание не
 * считал никто — и по таблице нельзя было сказать, нужна ли карточка вообще.
 *
 * Считается нажатие, а не отдача файла: тот же /card.png стоит в превью
 * через <img>, и счётчик на роуте картинки считал бы каждый показ страницы.
 *
 * Отдельный клиентский островок, потому что обе страницы серверные, а
 * обработчик через границу не передать. Внутри m.a, а не a: у портрета
 * ссылка появляется при прокрутке (initial/whileInView приходят пропсами с
 * сервера), и обёртка вокруг неё добавила бы лишний узел в столбец финала.
 * Без анимационных пропсов (итоги года) m.a рисуется обычной ссылкой.
 */
export function CardDownload({
  what,
  ...props
}: { what: CardKind } & Omit<ComponentProps<typeof m.a>, 'onClick'>) {
  return <m.a {...props} onClick={() => trackCardDownload(what)} />
}
