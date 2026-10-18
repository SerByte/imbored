'use client'

import { useId, useState, useSyncExternalStore } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { StatusLine } from '@/components/StatusLine'
import { tr, type Locale } from '@/lib/i18n'
import { createLocalStore, parseFlag } from '@/lib/localstore'
import { matchNoticeDue, pageNotices } from '@/lib/room'

/**
 * «Сообщить, когда сойдёмся» — одно уведомление о матче из скрытой вкладки.
 *
 * Сценарий узкий и настоящий: человек отсвайпал своё на ПК и ушёл в соседнее
 * окно, а пати досвайпывает. Вернуться он мог бы и сам (опрос при возвращении
 * покажет матч мгновенно), но не знает, КОГДА. Заголовок вкладки говорит это
 * тому, кто видит полосу вкладок; уведомление — тому, у кого браузер закрыт
 * другими окнами.
 *
 * Чего здесь нет и почему. Сервис-воркера нет (app/manifest.ts), значит
 * уведомление — только new Notification() со страницы, а оно работает лишь на
 * десктопе (pageNotices в lib/room). Закрытая вкладка не узнает ничего, и
 * строка под переключателем говорит это прямо: обещать «сообщим» без оговорки
 * было бы враньём ровно для того, кто вкладку закрыл.
 *
 * Выбор помнит устройство, а не аккаунт: разрешение на уведомления тоже живёт
 * в браузере, и «включено» на другом компьютере без него ничего бы не значило.
 */
const notifyStore = createLocalStore('imbored.room.notify', parseFlag)

/** Userdata мобильности — только в Chromium, в lib.dom её нет */
type UAData = { mobile?: boolean }

/**
 * Подписка на тип указателя — на модуле, как в components/ShareLink:
 * useSyncExternalStore требует стабильную функцию.
 */
function subscribeSupport(onChange: () => void) {
  const mq = window.matchMedia('(pointer: coarse)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function readSupport(): boolean {
  return pageNotices({
    hasNotification: 'Notification' in window,
    uaMobile: (navigator as Navigator & { userAgentData?: UAData }).userAgentData?.mobile,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  })
}

/** Сервер уведомлений не показывает: разметка до гидратации — без переключателя */
const noSupport = () => false

/**
 * Объявить матч уведомлением, если человек об этом просил (matchNoticeDue).
 * Зовёт страница комнаты — один раз на комнату.
 *
 * try/catch не для галочки: браузер, в котором pageNotices ошибся (мобильный
 * без userAgentData и с мышью), бросает TypeError из конструктора, и падать
 * из-за необязательного сигнала странице нельзя — церемония важнее.
 * tag — код комнаты: повторный показ той же комнаты заменит карточку, а не
 * положит вторую.
 *
 * locale — язык страницы комнаты: функция зовётся из эффекта, а не рисуется,
 * и useLocale ей недоступен. Слово — то же, что в заголовке вкладки
 * (roomTabTitle): «Сошлись» / «Matched».
 */
export function announceMatch(
  args: { name: string; roomId: string; selfCaused: boolean },
  locale: Locale = 'ru',
) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  const due = matchNoticeDue({
    enabled: notifyStore.fresh() === true,
    permission: Notification.permission,
    visible: document.visibilityState === 'visible',
    selfCaused: args.selfCaused,
  })
  if (!due) return
  try {
    const n = new Notification(`${tr(locale, { ru: 'Сошлись', en: 'Matched' })}: ${args.name}`, { tag: args.roomId })
    // Нажатие на карточку возвращает в комнату — ради этого она и показана
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // Сигнал необязательный: заголовок вкладки уже сказал то же самое
  }
}

export function MatchNotifyToggle() {
  const supported = useSyncExternalStore(subscribeSupport, readSupport, noSupport)
  const stored = useSyncExternalStore(notifyStore.subscribe, notifyStore.get, notifyStore.server)
  /**
   * Чем кончился запрос разрешения — строкой, а не погашенной кнопкой.
   * 'denied' — отказ, его снимают только в настройках сайта; 'default' —
   * запрос закрыли, не ответив, и следующее нажатие спросит снова. Слать
   * человека в настройки во втором случае значило бы гнать его зря.
   */
  const [miss, setMiss] = useState<'denied' | 'default' | null>(null)
  const noteId = useId()
  const locale = useLocale()

  if (!supported) return null

  // Включено — только вместе с разрешением: разрешение отзывают в настройках
  // сайта, и нажатая кнопка без него обещала бы то, чего не будет
  const on = stored === true && Notification.permission === 'granted'

  /*
   * Разрешение — строго по нажатию. Спрашивать при входе в комнату значит
   * выпрашивать доступ у того, кто ещё не знает, зачем он, — и браузеры за это
   * прячут запрос насовсем.
   *
   * Прежний отказ гаснет до await, а новый ставится только после него —
   * иначе повтор промолчит. Спрашиваем при любом «не разрешено», а не только
   * при 'default': после отказа браузер помнит 'denied', и без await сброс и
   * новый отказ шли бы в одном обработчике — React склеил бы их в одно
   * обновление, текст строки не менялся бы, и второе нажатие осталось бы без
   * отклика и для глаз, и для скринридера (components/StatusLine). На 'denied'
   * requestPermission отвечает сразу и без окна, так что лишнего вопроса нет.
   */
  async function toggle() {
    setMiss(null)
    if (on) {
      notifyStore.set(false)
      return
    }
    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission().catch(() => 'denied' as const)
    if (permission !== 'granted') {
      notifyStore.set(false)
      setMiss(permission)
      return
    }
    notifyStore.set(true)
  }

  return (
    <div className="relative flex flex-col items-center gap-1.5 text-center">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={on}
        aria-describedby={noteId}
        className="btn-glass py-3 text-sm"
      >
        {tr(locale, { ru: 'Сообщить, когда сойдёмся', en: 'Notify me when we match' })}
      </button>
      {/* Честная граница: без сервис-воркера закрытая вкладка ничего не узнает,
          а скрытая спрашивает сервер раз в минуту и не дольше часа
          (hiddenPollDelay в lib/roompoll). Связана с кнопкой: кто идёт по Tab,
          слышит границу вместе с именем, а не включает вслепую */}
      <p id={noteId} className="text-xs text-faint">
        {tr(locale, {
          ru: 'Сработает, пока вкладка открыта: в фоне проверяем раз в минуту, первый час.',
          en: 'Works while this tab is open: in the background we check once a minute, for the first hour.',
        })}
      </p>
      <StatusLine
        text={
          miss === 'denied'
            ? tr(locale, {
                ru: 'Браузер не разрешил уведомления — включить их можно в настройках сайта.',
                en: 'Your browser blocked notifications — you can turn them on in site settings.',
              })
            : miss === 'default'
              ? tr(locale, {
                  ru: 'Запрос закрыт без ответа — нажми ещё раз, если передумаешь.',
                  en: 'The prompt was closed without an answer — tap again if you change your mind.',
                })
              : null
        }
        className="text-xs text-dim"
      />
    </div>
  )
}
