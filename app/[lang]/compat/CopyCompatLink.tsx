'use client'

import { useLocale } from '@/components/LocaleProvider'
import { useLocaleRouter } from '@/components/useLocaleRouter'
import { useShareLink } from '@/components/ShareLink'
import { lp, tr } from '@/lib/i18n'
import { withRef } from '@/lib/track'
import { COMPAT_SHARE } from './sharecopy'

/**
 * className и label — необязательные, со старыми значениями по умолчанию.
 *
 * На странице результата кнопка стоит рядом с «Собрать пати вместе»: две
 * ember-заливки подряд означали бы, что действия равнозначны, хотя это не так.
 *
 * Логика отдачи ссылки переехала в useShareLink и общая с полем на хабе: на
 * телефоне это системная панель «Поделиться», на десктопе — буфер. Сценарий у
 * двух этих кнопок один и тот же, и расходиться им незачем.
 *
 * Адрес собирается в момент нажатия, а не при рендере: window на сервере нет,
 * а к нажатию он заведомо есть. Так обходится и прежняя оговорка про
 * `typeof window !== 'undefined'` при рендере, и правка состояния в эффекте.
 *
 * Адрес — на языке страницы: с /en/compat/… друг получает /en/compat/…, а не
 * русскую страницу. Подпись по умолчанию — тоже на нём (useLocale), поэтому
 * пропом она приходит только там, где своя.
 *
 * Если буфер закрыт наглухо (страница без фокуса, запрет в настройках,
 * webview мессенджера), кнопка уводит на /compat. Это не заглушка: там та же
 * ссылка стоит в поле, видимая и выделяемая руками, — то есть единственное
 * место, где из этого тупика есть выход. Своего поля у кнопки нет и быть не
 * может: она живёт и в ряду других действий, где лишняя строка снизу
 * разъехалась бы.
 */
export function CopyCompatLink({
  steamid,
  className = 'btn-ember is-block py-3',
  label,
}: {
  steamid: string
  className?: string
  label?: string
}) {
  const locale = useLocale()
  // push сам ставит префикс языка (useLocaleRouter): /en/compat на английской
  const router = useLocaleRouter()
  const copy = COMPAT_SHARE[locale]
  const share = useShareLink(
    'compat',
    () => withRef(`${window.location.origin}${lp(locale, `/compat/${steamid}`)}`, 'compat'),
    copy.title,
    copy.text,
    () => router.push('/compat'),
  )

  // Живая область — рядом с кнопкой, а не внутри: внутри она становится
  // частью имени кнопки, и объявление сливается с подписью
  return (
    <>
      <button type="button" onClick={() => void share.run()} className={className}>
        {share.label(label ?? tr(locale, { ru: 'Скопировать мою ссылку', en: 'Copy my link' }), {
          native: tr(locale, { ru: 'Отправить мою ссылку', en: 'Send my link' }),
        })}
      </button>
      {share.status}
    </>
  )
}
