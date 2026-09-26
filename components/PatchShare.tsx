'use client'

import { useState } from 'react'
import { ShareLinkInput, useShareLink } from '@/components/ShareLink'
import { patchShareUrl } from '@/lib/newspage'

/**
 * «Поделиться» на странице патча.
 *
 * Её обещали строка ленты и карточка игры («своим адресом патча можно
 * поделиться») — а кнопки на самой странице не было: адрес приходилось
 * копировать из строки браузера, без метки ref, и приход по такой ссылке
 * было не отличить от поиска.
 *
 * Своего поля со ссылкой у кнопки нет — она стоит в ряду ссылок под постом.
 * Поле появляется, только если скопировать не вышло ни одним способом
 * (буфер закрыт настройками, webview мессенджера): тогда адрес виден и
 * выделяется руками.
 */
const LINK = 'underline decoration-1 underline-offset-4'

export function PatchShare({ appid, gid, title }: { appid: number; gid: string; title: string }) {
  const [manual, setManual] = useState<string | null>(null)
  const urlOf = () => patchShareUrl(window.location.origin, appid, gid)
  const share = useShareLink(urlOf, title, 'Что изменилось — коротко по-русски', () => setManual(urlOf()))

  return (
    <>
      {/* Подчёркивание — на тексте, а не на кнопке: share.label оборачивает
          подпись в inline-flex, а в такой блок text-decoration родителя не
          проходит, и кнопка стояла бы голой рядом с подчёркнутыми соседями */}
      <button
        type="button"
        onClick={() => void share.run()}
        className="tap tap-tight font-semibold transition-opacity hover:opacity-70"
      >
        {share.label(<span className={LINK}>Поделиться</span>, {
          manual: <span className={LINK}>Скопируй адрес ниже</span>,
        })}
      </button>
      {share.status}
      {manual && (
        <div className="join is-link w-full">
          <ShareLinkInput url={manual} label="Адрес этой страницы" />
        </div>
      )}
    </>
  )
}
