'use client'

import { Icon } from '@/components/Icon'
import { useLocale } from '@/components/LocaleProvider'
import { tr } from '@/lib/i18n'
import { track } from '@/lib/track'

/** Какой веткой нажата кнопка: steam:// или магазин под пальцем (см. onClick) */
export type LaunchVia = 'steam' | 'store'

/**
 * Кнопка «играть».
 *
 * На десктопе `steam://run` открывает клиент Steam и запускает игру. На
 * телефоне этот протокол не поддерживается вовсе — нажатие просто ничего не
 * делает, и человек остаётся с мёртвой кнопкой. Поэтому там ведём в магазин:
 * ссылку перехватывает мобильное приложение Steam, а без него открывается сайт.
 *
 * РАЗВИЛКА ПО ВОЗМОЖНОСТИ УСТРОЙСТВА, А НЕ ПО ШИРИНЕ ОКНА, и это исправление.
 *
 * Стояло `hidden md:inline-block`, то есть вариант steam://run показывался
 * начиная с 768px. Абзац выше обосновывает развилку тем, что протокол не
 * поддерживается, — а реализована она была признаком ширины. iPad в портрете
 * это ровно 768 CSS-пикселей, iPad Air и Pro — 820 и 834, в альбоме 1024: НИ
 * ОДИН планшет не попадал в мобильную ветку и получал мёртвую кнопку.
 *
 * Дороже всего это в церемонии матча: там SteamLaunch — единственная кнопка
 * экрана, когда у игры нет storeUrl, то есть матч кончался тупиком.
 *
 * `pointer: fine` отвечает false на устройстве, где основной ввод — палец, и
 * не зависит от ширины окна вовсе. Проверено в браузере: десктоп даёт
 * pointer: fine, hover: hover, maxTouchPoints 0; эмуляция телефона — coarse,
 * hover: none, 5 точек касания.
 *
 * Неоднозначность разрешается В ПОЛЬЗУ МАГАЗИНА намеренно: ссылка на магазин
 * работает везде и всегда, steam:// — только иногда. Ошибиться в эту сторону
 * стоит одного лишнего перехода, в обратную — мёртвой кнопки.
 *
 * Тот же признак обязан стоять везде, где разметка зависит от того, какая
 * ветка здесь показана: «Страница в Steam» рядом с кнопкой на странице игры
 * и правило остановки под героем /play.
 *
 * onClick — любое нажатие, onLaunch — только настоящий запуск, то есть
 * десктопная steam://run. Разница нужна правилу остановки (lib/launchmemo.ts):
 * спрашивать «не зацепило?» того, кто на телефоне всего лишь открыл страницу
 * магазина, — спрашивать про игру, в которую он не играл.
 *
 * onClick получает ветку: 'steam' — ссылка steam://, 'store' — магазин под
 * пальцем. Оценку пишут оба нажатия, но магазинное — с intent 'store': оно
 * не запуск, и плана на вечер не закрывает (lib/eveningplan.ts). А нажимают
 * его как раз после «Сыграю вечером на ПК» — поставить игру на загрузку из
 * приложения Steam, о чём и говорит строка про загрузку ниже.
 *
 * mobileLabel={null} — на тач-устройстве кнопки нет вовсе. Это для мест, где
 * ссылка на магазин уже стоит рядом (страница игры): там мобильная ветка
 * была бы её точной копией.
 *
 * mode='install' — «Поставить на загрузку»: steam://install открывает в
 * клиенте окно установки, и к вечеру игра уже стоит. Для своей нетронутой и
 * заброшенной — тех, что скорее всего не установлены: план на вечер, который
 * начинается с загрузки, иначе кончается на ней. На телефоне протокола нет, а
 * магазин загрузку не начнёт, — там не ссылка, а строка о том, где это
 * сделать. onLaunch у загрузки не зовётся: она не запуск, и спрашивать через
 * десять минут «не зацепило?» не о чем.
 *
 * Подписи по умолчанию — на языке страницы, и считаются в теле, а не в
 * значениях параметров: язык знает только useLocale(), а хук в значении по
 * умолчанию не позовёшь. undefined — «подпись по умолчанию», null у
 * mobileLabel — «мобильной ветки нет», как и раньше. Названия пунктов
 * клиента Steam — его собственные английские («Library», «Install»).
 */
export function SteamLaunch({
  appid,
  className = '',
  mode = 'run',
  label: ownLabel,
  mobileLabel: ownMobileLabel,
  onClick,
  onLaunch,
  icon = false,
}: {
  appid: number
  className?: string
  mode?: 'run' | 'install'
  label?: string
  mobileLabel?: string | null
  onClick?: (via: LaunchVia) => void
  onLaunch?: () => void
  /**
   * Треугольник «играть» перед подписью — у главной кнопки героя. Только у
   * steam://run: ссылка в магазин и строка про загрузку ничего не запускают,
   * и треугольник на них обещал бы то, чего не будет.
   */
  icon?: boolean
}) {
  const locale = useLocale()
  const install = mode === 'install'
  const label =
    ownLabel ??
    (install
      ? tr(locale, { ru: 'Поставить на загрузку', en: 'Start the download' })
      : tr(locale, { ru: 'Запустить в Steam', en: 'Launch in Steam' }))
  const mobileLabel =
    ownMobileLabel === undefined
      ? install
        ? tr(locale, {
            ru: 'Поставить на загрузку можно из приложения Steam: «Библиотека» → игра → «Установить»',
            en: 'You can start the download in the Steam app: “Library” → the game → “Install”',
          })
        : tr(locale, { ru: 'Открыть в Steam', en: 'Open in Steam' })
      : ownMobileLabel
  return (
    <>
      <a
        href={`steam://${mode}/${appid}`}
        onClick={() => {
          onClick?.('steam')
          if (mode === 'run') onLaunch?.()
          track('launch_click')
        }}
        className={`hidden pointer-fine:inline-block ${className}`}
      >
        {icon && mode === 'run' && <Icon name="play" className="mr-2 inline-block align-[-0.125em]" />}
        {label}
      </a>
      {mobileLabel !== null &&
        (mode === 'install' ? (
          <span className={`inline-block pointer-fine:hidden ${className}`}>{mobileLabel}</span>
        ) : (
          <a
            href={`https://store.steampowered.com/app/${appid}/`}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              onClick?.('store')
              track('launch_click')
            }}
            className={`inline-block pointer-fine:hidden ${className}`}
          >
            {mobileLabel}
          </a>
        ))}
    </>
  )
}
