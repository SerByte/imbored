import Link from 'next/link'
import type { ReactNode } from 'react'
import { reconnectHref } from '@/lib/destination'

/**
 * ЧТО ДЕЛАТЬ, КОГДА STEAM НЕ ОТДАЁТ СПИСОК ИГР.
 *
 * Одна панель на два места, и это не экономия строк. Инструкция была написана
 * в карточке подключения — там, где человек упирается в отказ впервые. Но тот
 * же отказ доезжает и до библиотеки: сессия есть, снимок есть, а игр в нём
 * ноль, и страница до этой правки объявляла пустоту хорошей новостью.
 *
 * Второй экземпляр текста разъехался бы с первым при первой же правке шагов —
 * а шаги описывают чужой интерфейс, который меняется без предупреждения.
 * Поэтому и строка о скрытом времени (PlaytimeHiddenNote ниже) живёт здесь
 * же и берёт шаг и ссылку отсюда, а не своей копией.
 *
 * Компонент без 'use client' намеренно: в библиотеке он остаётся серверным. В
 * карточке подключения он приезжает частью клиентского бандла — и только оттуда
 * может прийти onRetry: обработчик из серверного компонента Next не пропустит.
 *
 * «Я ОТКРЫЛ — ПРОВЕРИТЬ». Последним шагом было «вернись сюда и попробуй
 * снова» — без кнопки. Что значит «снова», человек угадывал сам: после отказа
 * входа через Steam единственной дверью была тихая строка «Войти через Steam»
 * в карточке, а заметное поле для ссылки давало вход только для чтения. Теперь
 * проверка — кнопкой в самой инструкции, и ведёт она тем же путём, каким
 * пришёл отказ: retryHref — снова вход через Steam с тем же carry (адрес
 * собирает вызывающий: steamHref карточки, steamLoginFor на страницах),
 * onRetry — повторная отправка той же ссылки из поля.
 *
 * Подпись про минуту-другую — не вежливость: Steam применяет смену
 * приватности с задержкой, и «открыл, сразу проверил — опять скрыто» бывает у
 * тех, кто всё сделал правильно. Без неё второй отказ читался бы как «не
 * работает», а не как «подожди».
 */
export function PrivacyHelp({
  retryHref,
  onRetry,
  retrying = false,
}: {
  /** Проверка входом через Steam: адрес входа, который вернёт туда же */
  retryHref?: string
  /**
   * Проверка повторной отправкой ссылки на профиль — только из клиентского
   * компонента. Обязана сама пропускать вызов, пока проверка идёт: кнопка на
   * это время не disabled (см. ниже)
   */
  onRetry?: () => void
  /** Проверка по onRetry идёт: кнопка говорит об этом, второй раз не шлёт, но фокус держит */
  retrying?: boolean
} = {}) {
  const retry = onRetry !== undefined || retryHref !== undefined
  return (
    <div className="panel-lift p-5 text-sm leading-relaxed anim-rise">
      <p className="font-semibold text-ink mb-2">Библиотека скрыта настройками Steam</p>
      <p className="text-dim">
        Steam по умолчанию прячет список игр даже при публичном профиле. Открой его — это меняется
        одной настройкой:
      </p>
      <ol className="list-decimal list-inside text-dim mt-3 space-y-1.5">
        <li>
          Зайди в <PrivacySettingsLink>настройки приватности Steam</PrivacySettingsLink>
        </li>
        <li>
          «Доступ к игровой информации» → <span className="text-ink">Открытый</span>
        </li>
        <li>{PLAYTIME_STEP}</li>
        <li>{retry ? `Вернись сюда и нажми «${RETRY_LABEL}»` : 'Вернись сюда и попробуй снова'}</li>
      </ol>
      {retry && (
        <div className="mt-4 flex flex-col items-start gap-2">
          {/*
            Обычная ссылка, а не Link: вход через Steam — переход на чужой сайт
            через наш роут, клиентскому роутеру тут делать нечего (как у
            NeedSteam).
          */}
          {onRetry ? (
            /* aria-disabled, а не disabled: пока идёт проверка, нажатая кнопка
               обязана удержать фокус. disabled выбрасывал его в body — и после
               повторного отказа клавиатура и скринридер начинали со страницы
               сверху, хотя панель ради этого и не убирается (rechecking в
               ConnectCard). Кнопка поэтому жмётся и во время проверки, и
               повтор гасит сам onRetry (recheckProfile — по busy). */
            <button
              type="button"
              onClick={onRetry}
              aria-disabled={retrying}
              aria-busy={retrying}
              className="btn-glass aria-disabled:opacity-60"
            >
              {retrying ? 'Проверяю…' : RETRY_LABEL}
            </button>
          ) : (
            <a href={retryHref} className="btn-glass">
              {RETRY_LABEL}
            </a>
          )}
          <p className="text-xs text-dim">
            Steam иногда применяет настройку минуту-другую — если сразу не вышло, подожди и проверь
            ещё раз.
          </p>
        </div>
      )}
    </div>
  )
}

/** Одно имя на кнопку и на шаг, который на неё ссылается */
const RETRY_LABEL = 'Я открыл — проверить'

/**
 * Шаг про время игры — отдельной строкой, потому что мест у него два: третий
 * пункт инструкции выше и строка о скрытом времени. Название галочки — слово
 * из чужого интерфейса, и поменяться оно должно в одном месте.
 */
export const PLAYTIME_STEP = 'Сними галочку «Всегда скрывать общее время игры»'

function PrivacySettingsLink({ children }: { children: ReactNode }) {
  return (
    <a
      href="https://steamcommunity.com/my/edit/settings"
      target="_blank"
      rel="noreferrer"
      className="tap tap-tight text-ember-text hover:underline"
    >
      {children}
    </a>
  )
}

/**
 * СТРОКА «ПОХОЖЕ, STEAM СКРЫВАЕТ ТВОЁ ВРЕМЯ» — /play и /library.
 *
 * Список игр открыт, а часы — нет: галочка «Всегда скрывать общее время игры»
 * живёт в Steam отдельно от доступа к списку, и ошибки private в этом случае
 * не бывает. Панель выше человек поэтому не видел никогда, а продукт молча
 * работал вполсилы (lib/playtime.ts). Строка говорит, что случилось, чем это
 * ему обходится и как открыть — тем же шагом, что и в панели.
 *
 * «Похоже» — не вежливость: признак — эвристика, и библиотека из десяти ни
 * разу не запущенных игр под него тоже попадает.
 *
 * Последний шаг — подключить заново, а не «вернись и попробуй»: снимок
 * библиотеки сам обновится только через несколько часов (SNAPSHOT_MAX_AGE_SEC
 * в lib/warm.ts), а подключение пишет свежий сразу.
 */
export function PlaytimeHiddenNote({ className = '' }: { className?: string }) {
  return (
    <div className={`panel-lift px-4 py-3 text-sm leading-relaxed text-dim ${className}`}>
      <p>
        <span className="font-semibold text-ink">Похоже, Steam скрывает твоё время в играх</span> —
        поэтому вкус пока считается по всем играм поровну, а не по часам. Чтобы подбор стал
        точнее: <PrivacySettingsLink>настройки приватности Steam</PrivacySettingsLink> →{' '}
        {PLAYTIME_STEP} →{' '}
        <Link href={reconnectHref()} className="tap tap-tight text-ember-text hover:underline">
          подключи библиотеку заново
        </Link>
        .
      </p>
    </div>
  )
}
