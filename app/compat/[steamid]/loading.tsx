import { Skel, SkelPage } from '@/components/Skeleton'

/**
 * Каркас страницы совместимости.
 *
 * media-dark — обязательно: кадр ожидания стоит между двумя тёмными экранами,
 * и без класса зоны на светлой теме в этом промежутке вспыхивает молочный
 * лист (см. соседний фолбэк /whatsnew, где та же ловушка расписана подробно).
 *
 * Это самый вероятный первый экран незнакомого человека: по ссылке
 * /compat/<steamid> приходят из чужого чата, и здесь сервису дают ровно один
 * кадр на то, чтобы выглядеть живым. Кольцо и два имени на своих местах
 * говорят «сейчас будет процент» — дуга в центре не говорит ничего.
 */
export default function CompatLoading() {
  return (
    <SkelPage className="flex-1">
      <section
        className="media-dark media-full relative flex flex-col justify-end overflow-hidden"
        style={{ minHeight: '88svh' }}
      >
        <div aria-hidden className="grain" />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-5 pb-16 pt-40 md:flex-row md:items-end md:gap-12">
          {/* кольцо процента: 200 px, на телефоне ужато до 0.8 — как в странице */}
          <Skel className="size-40 shrink-0 rounded-full md:size-[200px]" />

          <div className="min-w-0 w-full">
            <Skel className="h-4 w-[9rem] rounded-[4px] mb-3" delay={80} />
            {/* «Имя × Имя» */}
            <Skel className="h-[71px] w-[min(100%,26rem)]" delay={150} />
            {/* вердикт */}
            <Skel className="mt-5 h-[46px] w-[min(100%,20rem)]" delay={220} />
            {/* «N общих игр · M общих тем» */}
            <Skel className="mt-3 h-4 w-[min(100%,17rem)] rounded-[4px]" delay={290} />
          </div>
        </div>
      </section>
    </SkelPage>
  )
}
