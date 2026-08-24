'use client'

import { useRouter } from 'next/navigation'
import { useShareLink } from '@/components/ShareLink'

const TITLE = 'Совместимость вкусов — imbored'
const TEXT = 'Сравним библиотеки Steam по-настоящему, а не по анкете'

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
  label = 'Скопировать мою ссылку',
}: {
  steamid: string
  className?: string
  label?: string
}) {
  const router = useRouter()
  const { run, state, native } = useShareLink(
    () => `${window.location.origin}/compat/${steamid}`,
    TITLE,
    TEXT,
    () => router.push('/compat'),
  )

  return (
    <button type="button" onClick={() => void run()} className={className}>
      {state === 'done' ? 'Скопировано ✓' : native ? 'Отправить мою ссылку' : label}
    </button>
  )
}
