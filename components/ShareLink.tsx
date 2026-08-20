'use client'

import { useRef, useState, useSyncExternalStore } from 'react'

type State = 'idle' | 'done' | 'manual'

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
  const [state, setState] = useState<State>('idle')
  const native = useSyncExternalStore(subscribeCoarse, readCoarse, () => false)

  async function run() {
    const url = getUrl()
    if (!url) return
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
      setState('done')
      setTimeout(() => setState('idle'), 1600)
      return
    }

    // Оба пути закрыты. Тогда единственное честное действие — показать саму
    // ссылку выделенной и сказать об этом подписью, а не оставлять нажатие
    // без всякого следа.
    onManual?.()
    setState('manual')
    setTimeout(() => setState('idle'), 3200)
  }

  return { run, state, native }
}

/**
 * Поле со ссылкой и кнопка рядом.
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
  const { run, state, native } = useShareLink(() => url, title, text, () => {
    ref.current?.focus()
    ref.current?.select()
  })
  const id = 'share-' + url.replace(/\W+/g, '').slice(-10)

  return (
    <div className="flex flex-col gap-2.5 sm:flex-row">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type="text"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-[14px] border border-edge bg-surface px-4 py-3 font-mono text-sm text-ink"
      />
      <button
        type="button"
        onClick={() => void run()}
        className="shrink-0 rounded-[14px] bg-ember px-5 py-3 font-semibold text-on-ember transition hover:brightness-110 cursor-pointer"
      >
        {state === 'done'
          ? 'Скопировано ✓'
          : state === 'manual'
            ? 'Скопируй вручную'
            : native
              ? 'Отправить'
              : 'Скопировать'}
      </button>
    </div>
  )
}
