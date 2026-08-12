import { Spinner } from '@/components/Spinner'

/**
 * Общий фолбэк Suspense для серверных страниц (/library, /game, /portrait, /compat).
 * Раньше его не было вообще: страница просто не появлялась, пока не отработает
 * запрос к Steam и к базе, — на медленной сети это выглядело как зависший переход.
 */
export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center py-32">
      <Spinner />
    </div>
  )
}
