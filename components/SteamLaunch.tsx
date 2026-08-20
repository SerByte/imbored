'use client'

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
 */
export function SteamLaunch({
  appid,
  className = '',
  label = 'Запустить в Steam',
  mobileLabel = 'Открыть в Steam',
  onClick,
}: {
  appid: number
  className?: string
  label?: string
  mobileLabel?: string
  onClick?: () => void
}) {
  return (
    <>
      <a
        href={`steam://run/${appid}`}
        onClick={onClick}
        className={`hidden pointer-fine:inline-block ${className}`}
      >
        {label}
      </a>
      <a
        href={`https://store.steampowered.com/app/${appid}/`}
        target="_blank"
        rel="noreferrer"
        onClick={onClick}
        className={`inline-block pointer-fine:hidden ${className}`}
      >
        {mobileLabel}
      </a>
    </>
  )
}
