'use client'

import { useLocale } from '@/components/LocaleProvider'
import { steamLoginFor } from '@/lib/destination'
import { lp, tr } from '@/lib/i18n'

type Why = 'save' | 'launch' | 'room' | 'host' | 'see'

type Props = {
  from: string
  /**
   * save — общее «сохранять оценки»; launch — у кнопки запуска; room — у
   * создания пати; host — у ✕ и доски в чужой по происхождению пати; see — на
   * /library вместо полок, которые сессии по ссылке не отдаются
   */
  why?: Why
  className?: string
}

/**
 * Строка для сессии, которой писать нельзя.
 *
 * Сессия по вставленной ссылке на профиль смотрит всё, но ничего не
 * сохраняет: оценки, баны и комнаты ей отвечают 403 needsteam (isWriter в
 * lib/server). Без этой строки кнопки просто исчезали бы — или, хуже,
 * жались бы вхолостую, — и человек не узнал бы ни почему, ни что сделать.
 *
 * Формулировка — по месту (why): безликое «чтобы сохранять оценки» под
 * кнопкой «Запустить» не говорило, что теряется именно сейчас. У запуска —
 * что он не запишется и спросить «как игра» потом будет некому; у пати — что
 * свою комнату создаёт вошедший через Steam; у хоста пати — что убирать
 * людей и вывешивать её на доску может только он же со входом через Steam
 * (хостом по ссылке становятся, когда рука переходит от ушедшего); у
 * библиотеки — что оценок, скрытого и вечеров на ней нет не потому, что их
 * нет вовсе: их просто не показывают тому, кто не доказал, что профиль его.
 * Ссылка возвращает туда же,
 * где нажал (steamLoginFor), — вход ради того, чтобы нажать «Зашло», не должен
 * заканчиваться квизом.
 *
 * Обычная ссылка, а не Link: вход через Steam — переход на чужой сайт через
 * наш роут, клиентскому роутеру тут делать нечего.
 *
 * ЯЗЫК — СВОЙ, А НЕ ПРОПСОМ. Строка стоит в десяти местах, и половина из них —
 * серверные страницы (/library, /play, комнаты), где языка в пропсах нет.
 * Поэтому она клиентская и берёт язык из контекста (useLocale), а from
 * по-прежнему приходит без префикса: на /en строка сама ставит его адресу
 * возврата (lp), и steamLoginFor везёт lang=en через Steam — вход
 * возвращает на английскую страницу, а не на русскую.
 *
 * Сама NeedSteam — без хуков: слова рисует NeedSteamLine под ней. Страницы и
 * их тесты зовут её и как функцию (app/[lang]/library/page.test.ts рендерит
 * NeedSteam(props) напрямую), а хук вне рендера React бросает. Без
 * провайдера — русский, как было.
 */
export function NeedSteam(props: Props) {
  return <NeedSteamLine {...props} />
}

function NeedSteamLine({ from, why = 'save', className = '' }: Props) {
  const locale = useLocale()
  const link = (
    <a href={steamLoginFor(lp(locale, from))} className="tap tap-tight text-ember-text hover:underline">
      {why === 'save'
        ? tr(locale, { ru: 'войди через Steam', en: 'sign in with Steam' })
        : tr(locale, { ru: 'Войди через Steam', en: 'Sign in with Steam' })}
    </a>
  )
  if (why === 'launch') {
    return (
      <p className={`text-sm text-dim ${className}`}>
        {tr(locale, {
          ru: (
            <>
              Сейчас только просмотр: запуск не запишется, и спросить потом, как тебе игра, будет
              некому. {link} — и сервис начнёт запоминать.
            </>
          ),
          en: (
            <>
              {"View only for now: this launch won't be saved, so we can't ask you later how the game went. "}
              {link}
              {" and we'll start keeping track."}
            </>
          ),
        })}
      </p>
    )
  }
  if (why === 'room') {
    return (
      <p className={`text-sm text-dim ${className}`}>
        {tr(locale, {
          ru: (
            <>
              Свою пати создаёт вошедший через Steam: ссылка на профиль не доказывает, что он твой.{' '}
              {link} — и сразу к выбору настроения.
            </>
          ),
          en: (
            <>
              {"Only someone signed in with Steam can start a party: a profile link doesn't prove the profile is yours. "}
              {link}
              {" and you'll go straight to picking a mood."}
            </>
          ),
        })}
      </p>
    )
  }
  if (why === 'host') {
    return (
      <p className={`text-sm text-dim ${className}`}>
        {tr(locale, {
          ru: (
            <>
              Убирать людей и вывешивать пати на доску может хост, вошедший через Steam: ссылка на
              профиль не доказывает, что он твой. {link} — и продолжишь.
            </>
          ),
          en: (
            <>
              {
                "Only a host signed in with Steam can remove people and put the party on the board: a profile link doesn't prove the profile is yours. "
              }
              {link}
              {' to carry on.'}
            </>
          ),
        })}
      </p>
    )
  }
  if (why === 'see') {
    return (
      <p className={`text-sm text-dim ${className}`}>
        {tr(locale, {
          ru: (
            <>
              Оценки, скрытые игры и «Твои вечера» видит только вошедший через Steam: ссылка на
              профиль не доказывает, что он твой. {link} — и они будут здесь.
            </>
          ),
          en: (
            <>
              {
                "Only someone signed in with Steam can see ratings, hidden games and “Your evenings”: a profile link doesn't prove the profile is yours. "
              }
              {link}
              {" and they'll be right here."}
            </>
          ),
        })}
      </p>
    )
  }
  return (
    <p className={`text-sm text-dim ${className}`}>
      {tr(locale, {
        ru: <>Чтобы сохранять оценки и создавать комнаты — {link}</>,
        en: <>To save ratings and create rooms, {link}</>,
      })}
    </p>
  )
}
