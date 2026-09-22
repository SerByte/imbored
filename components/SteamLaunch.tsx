'use client'

/**
 * Кнопка «играть».
 *
 * На десктопе `steam://run` открывает клиент Steam и запускает игру. На
 * телефоне этот протокол не поддерживается вовсе — нажатие просто ничего не
 * делает, и человек остаётся с мёртвой кнопкой. Поэтому там ведём в магазин:
 * ссылку перехватывает мобильное приложение Steam, а без него открывается сайт.
 *
 * onClick — любое нажатие, onLaunch — только настоящий запуск, то есть
 * десктопная steam://run. Разница нужна правилу остановки (lib/launchmemo.ts):
 * спрашивать «не зацепило?» того, кто на телефоне всего лишь открыл страницу
 * магазина, — спрашивать про игру, в которую он не играл.
 */
export function SteamLaunch({
  appid,
  className = '',
  label = 'Запустить в Steam',
  mobileLabel = 'Открыть в Steam',
  onClick,
  onLaunch,
}: {
  appid: number
  className?: string
  label?: string
  mobileLabel?: string
  onClick?: () => void
  onLaunch?: () => void
}) {
  return (
    <>
      <a
        href={`steam://run/${appid}`}
        onClick={() => {
          onClick?.()
          onLaunch?.()
        }}
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
