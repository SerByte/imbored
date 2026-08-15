import { Spinner } from '@/components/Spinner'

/**
 * Свой фолбэк у этой ветки, а не общий из app/loading.tsx.
 *
 * Переключение вкладки — обычная навигация с новым параметром, страница
 * force-dynamic, значит граница Suspense показывается обязательно. Общий фолбэк
 * рендерится ВНЕ .whatsnew, и на этом коротком кадре разваливается всё разом:
 * фон уходит в :root (в светлой теме это белый лист между двумя почти чёрными
 * экранами), :root:has(.whatsnew) перестаёт совпадать и шапка с подвалом
 * перекрашиваются на полпути, а .spinner берёт var(--ember) и становится
 * оранжевым — единственным цветом, которого в этом мире нет по замыслу.
 */
export default function Loading() {
  return (
    <div className="whatsnew flex min-h-screen flex-1 items-center justify-center">
      <Spinner />
    </div>
  )
}
