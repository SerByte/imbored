'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react'
import { Icon, type IconName } from '@/components/Icon'
import { track } from '@/lib/track'

export type ShareState = 'idle' | 'done' | 'manual'

/**
 * Подписка на тип указателя. На модуле, а не в компоненте: useSyncExternalStore
 * требует стабильную функцию, иначе пересоздание подписки на каждый рендер.
 */
function subscribeCoarse(onChange: () => void) {
  const mq = window.matchMedia('(pointer: coarse)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function readCoarse() {
  return typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches
}

/**
 * Запасной путь в буфер через временное поле.
 *
 * navigator.clipboard.writeText отказывает чаще, чем кажется: страница без
 * фокуса, отключённое разрешение, встроенный webview мессенджера — и во всех
 * этих случаях промис просто отклоняется. Пока отказ глотался молча, нажатие
 * выглядело сломанной кнопкой: подпись не менялась, ссылка не копировалась,
 * объяснения не было.
 *
 * execCommand('copy') устарел, но работает без разрешений и ровно там, где
 * отказывает асинхронный API, — то есть закрывает не вкус, а дыру.
 */
function copyFallback(url: string): boolean {
  try {
    const field = document.createElement('textarea')
    field.value = url
    field.setAttribute('readonly', '')
    // Вне экрана, но НЕ display:none и не visibility:hidden — из скрытого
    // поля выделение не читается, и копировать было бы нечего.
    field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    field.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * Отдать ссылку другому человеку.
 *
 * На телефоне это системная панель «Поделиться», на десктопе — буфер обмена, и
 * разделяет их (pointer: coarse), а не наличие navigator.share. Проверки
 * возможности мало: Chrome на Windows тоже умеет share и открывает панель
 * Windows — то есть на десктопе вместо мгновенного «в буфере» человек получал
 * бы лишнее окно ради того, что и так делается по Ctrl+V. Сценарий продукта
 * телефонный: ссылку на сравнение кидают в чат с телефона, и системная панель
 * там ровно то, чего от кнопки ждут.
 *
 * useSyncExternalStore, а не useState с эффектом: matchMedia — внешний
 * источник, серверный снимок честно равен false (панели там нет), поэтому
 * первый клиентский кадр совпадает с серверной разметкой без всякой правки
 * состояния после монтирования.
 *
 * Адрес приходит функцией, а не строкой: у кнопки на странице результата его
 * можно узнать только из window, а трогать window при рендере нельзя. Функция
 * зовётся в момент нажатия, когда window заведомо есть.
 */
export function useShareLink(
  getUrl: () => string,
  title: string,
  text: string,
  /** Показать ссылку человеку, когда скопировать не вышло ни одним способом. */
  onManual?: () => void,
) {
  const [state, setState] = useState<ShareState>('idle')
  const native = useSyncExternalStore(subscribeCoarse, readCoarse, () => false)
  /*
   * Один таймер на кнопку. Раньше каждое нажатие ставило свой setTimeout, и
   * второе нажатие через секунду гасило «Скопировано» раньше срока — первым
   * таймером; а уход со страницы оставлял его висеть над размонтированным.
   */
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const flash = (next: ShareState, ms: number) => {
    clearTimeout(timer.current)
    setState(next)
    timer.current = setTimeout(() => setState('idle'), ms)
  }

  async function run() {
    const url = getUrl()
    if (!url) return
    // Намерение поделиться — шаг воронки, чем бы ни кончилась панель
    track('share_click')
    if (native) {
      try {
        await navigator.share({ title, text, url })
        // Панель закрыли — это не ошибка и не успех: галочку не показываем,
        // потому что отправил человек или передумал, знать нельзя.
        return
      } catch {
        // Отказ от панели или её отсутствие — падаем в буфер, а не в тишину.
      }
    }

    let copied = false
    try {
      await navigator.clipboard.writeText(url)
      copied = true
    } catch {
      copied = copyFallback(url)
    }

    if (copied) {
      flash('done', 1600)
      return
    }

    // Оба пути закрыты. Тогда единственное честное действие — показать саму
    // ссылку выделенной и сказать об этом подписью, а не оставлять нажатие
    // без всякого следа.
    onManual?.()
    flash('manual', 3200)
  }

  /**
   * Подпись кнопки — одна на все места, где делятся ссылкой.
   *
   * Отклик «Скопировано» был свой в каждом месте: на /compat — текст, у
   * кнопки сравнения — текст с галочкой, в пати — галочка вместо иконки
   * ссылки. Теперь он один и ровно здесь: «Скопировано» с галочкой. Место
   * задаёт только свою подпись в покое, на телефоне (там откроется панель
   * «Поделиться») и при отказе буфера.
   *
   * После системной панели галочки нет: отправил человек или передумал,
   * знать нельзя (см. run).
   */
  function label(
    idle: ReactNode,
    o: { native?: ReactNode; manual?: ReactNode; icon?: IconName; iconSize?: number } = {},
  ): ReactNode {
    if (state === 'done') {
      return (
        <ShareMark icon="check" size={o.iconSize}>
          Скопировано
        </ShareMark>
      )
    }
    const text = state === 'manual' ? (o.manual ?? idle) : native ? (o.native ?? idle) : idle
    return (
      <ShareMark icon={o.icon} size={o.iconSize}>
        {text}
      </ShareMark>
    )
  }

  /*
   * Живая область для скринридера — стоит в разметке всегда, текст приходит
   * потом: область, вставленная вместе с текстом, зачитывается не каждой
   * парой браузера и скринридера (тот же приём, что у StopAsk и OutcomeAsk).
   * Смена подписи на кнопке сама по себе не объявляется вовсе.
   */
  const status = (
    <span role="status" className="sr-only">
      {state === 'done' ? 'Ссылка скопирована' : state === 'manual' ? 'Скопировать не вышло' : ''}
    </span>
  )

  return { run, state, native, label, status }
}

export type ShareLink = ReturnType<typeof useShareLink>

/** Подпись с иконкой — одна строка, которая одинаково садится в btn-ember, btn-glass и action-tile */
function ShareMark({ icon, size = 16, children }: { icon?: IconName; size?: number; children: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      {icon && <Icon name={icon} size={size} />}
      {children}
    </span>
  )
}

/**
 * Поле со ссылкой и кнопка рядом — одной пилюлей, как вход на главной (.join).
 *
 * Ссылка ВИДНА, и это главное отличие от прежней одинокой кнопки
 * «Скопировать»: страница целиком про то, что ты сейчас кому-то передашь, а
 * передаваемое было невидимым. Увидеть адрес нужно и просто по-человечески —
 * убедиться, что отправляешь своё, — и технически: если буфер закрыт
 * настройками браузера, ссылку остаётся выделить руками.
 *
 * readOnly input, а не div: поле выделяется целиком одним нажатием, работают
 * Ctrl+A и Ctrl+C, и оно доступно с клавиатуры как поле. select() на фокусе —
 * чтобы это одно нажатие сразу давало готовое к копированию выделение.
 *
 * id — из useId, а не из хвоста адреса: у всех ссылок хвост теперь «?ref=…»,
 * и два поля на странице получали один и тот же id.
 */
export function ShareLinkField({
  url,
  label,
  title,
  text,
}: {
  url: string
  /** подпись поля для скринридера: видимой подписи здесь нет по месту */
  label: string
  title: string
  text: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const share = useShareLink(() => url, title, text, () => {
    ref.current?.focus()
    ref.current?.select()
  })

  return (
    <div className="join is-link">
      <ShareLinkInput url={url} label={label} inputRef={ref} />
      <button type="button" onClick={() => void share.run()} className="btn-ember is-block whitespace-nowrap px-5">
        {share.label('Скопировать', { native: 'Отправить', manual: 'Скопируй вручную' })}
      </button>
      {share.status}
    </div>
  )
}

/**
 * Та же ссылка без кнопки — запасной путь, когда скопировать не вышло: поле
 * в пилюле, выделяется одним нажатием. Внутри .join.is-link — в общей
 * пилюле с кнопкой; одно — в своей.
 */
export function ShareLinkInput({
  url,
  label,
  inputRef,
  describedBy,
}: {
  url: string
  label: string
  inputRef?: Ref<HTMLInputElement>
  describedBy?: string
}) {
  const id = useId()
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        readOnly
        value={url}
        aria-describedby={describedBy}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
      />
    </>
  )
}
