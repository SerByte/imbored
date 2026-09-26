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
export function PatchShare({ appid, gid, title }: { appid: number; gid: string; title: string }) {
  const [manual, setManual] = useState<string | null>(null)
  const urlOf = () => patchShareUrl(window.location.origin, appid, gid)
  const share = useShareLink(urlOf, title, 'Что изменилось — коротко по-русски', () => setManual(urlOf()))

  return (
    <>
      <button
        type="button"
        onClick={() => void share.run()}
        className="tap tap-tight font-semibold underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
      >
        {share.label('Поделиться', { manual: 'Скопируй адрес ниже' })}
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
