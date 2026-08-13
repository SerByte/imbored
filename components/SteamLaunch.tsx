'use client'

/**
 * Кнопка «играть».
 *
 * На десктопе `steam://run` открывает клиент Steam и запускает игру. На
 * телефоне этот протокол не поддерживается вовсе — нажатие просто ничего не
 * делает, и человек остаётся с мёртвой кнопкой. Поэтому там ведём в магазин:
 * ссылку перехватывает мобильное приложение Steam, а без него открывается сайт.
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
        className={`hidden md:inline-block ${className}`}
      >
        {label}
      </a>
      <a
        href={`https://store.steampowered.com/app/${appid}/`}
        target="_blank"
        rel="noreferrer"
        onClick={onClick}
        className={`md:hidden inline-block ${className}`}
      >
        {mobileLabel}
      </a>
    </>
  )
}
