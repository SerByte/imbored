'use client'

import { useState } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { ShareLinkInput, useShareLink } from '@/components/ShareLink'
import { tr } from '@/lib/i18n'
import { matchShareCopy, matchShareUrl } from '@/lib/matchshare'

/**
 * «Поделиться» на экране матча.
 *
 * Кнопка жила только в лобби — «Скопировать ссылку для друзей», — а на
 * главной эмоции продукта поделиться было нечем: «Это матч!», игра, магазин и
 * тупик. А весть «играем в X» кидают в общий чат — тем, кто опоздал к
 * выбору, — и адрес приходилось копировать из строки браузера, без метки и с
 * чужими хвостами.
 *
 * Логика отдачи — общая (useShareLink): на телефоне системная панель, на
 * десктопе буфер, отклик «Скопировано» — один на весь сайт. Своего поля со
 * ссылкой у кнопки нет, как у PatchShare: поле появляется, только если
 * скопировать не вышло ни одним способом, и тогда адрес виден и выделяется
 * руками.
 *
 * Стекло, а не вторая белая кнопка: главное здесь по-прежнему «играть в то, о
 * чём договорились» — магазин или запуск выше. Живёт в куске церемонии и
 * импортируется только ею (см. lib/matchshare).
 *
 * Адрес и текст — на языке того, кто делится: с /en весть уходит английской
 * ссылкой, и опоздавший друг читает экран сошедшейся комнаты по-английски.
 */
export function MatchShare({
  roomId,
  name,
  forCount,
  memberCount,
}: {
  roomId: string
  name: string
  /** сколько участников за; null — не знаем */
  forCount: number | null
  memberCount: number
}) {
  const locale = useLocale()
  const [manual, setManual] = useState<string | null>(null)
  const urlOf = () => matchShareUrl(window.location.origin, roomId, locale)
  const { title, text } = matchShareCopy({ name, forCount, memberCount }, locale)
  const share = useShareLink('match', urlOf, title, text, () => setManual(urlOf()))

  return (
    <>
      <button type="button" onClick={() => void share.run()} className="btn-glass px-5 py-2.5 text-sm">
        {share.label(tr(locale, { ru: 'Поделиться', en: 'Share' }), {
          icon: 'link',
          manual: tr(locale, { ru: 'Скопируй ссылку ниже', en: 'Copy the link below' }),
        })}
      </button>
      {/* Живая область — рядом с кнопкой: внутри она стала бы частью её имени */}
      {share.status}
      {manual && (
        <div className="join is-link w-full max-w-sm">
          <ShareLinkInput url={manual} label={tr(locale, { ru: 'Ссылка на вашу пати', en: 'Link to your party' })} />
        </div>
      )}
    </>
  )
}
