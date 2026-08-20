import { Skel, SkelPage } from '@/components/Skeleton'

/**
 * Свой фолбэк у этой ветки, а не общий из app/loading.tsx.
 *
 * Переключение вкладки — обычная навигация с новым параметром, страница
 * force-dynamic, значит граница Suspense показывается обязательно. Общий
 * фолбэк рендерится ВНЕ .whatsnew, и на этом коротком кадре разваливается всё
 * разом: фон уходит в :root (в светлой теме это белый лист между двумя почти
 * чёрными экранами), :root:has(.whatsnew) перестаёт совпадать и шапка с
 * подвалом перекрашиваются на полпути, а раньше здесь стоял ещё и .spinner,
 * который брал var(--ember) и становился оранжевым — единственным цветом,
 * которого в этом мире нет по замыслу.
 *
 * Каркас вместо дуги важен именно здесь: вкладки переключаются часто, и
 * прыжок «пустой экран → обложка во весь экран» человек видит по несколько
 * раз за посещение. Геометрия повторяет components/whatsnew/Cover.tsx —
 * надзаголовок, дата, огромное название, подзаголовок патча, счётчики.
 */
export default function WhatsNewLoading() {
  return (
    <SkelPage className="whatsnew min-h-screen">
      <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden">
        <div aria-hidden className="grain" />
        {/*
          Обложка выровнена по НИЗУ, поэтому лишний блок в каркасе поднимает
          вверх весь текст разом — включая название во весь экран. Отсюда два
          решения, оба против соблазна «нарисовать побольше»:

          1. Пересказа (tldr) здесь нет, хотя у части патчей он есть. Каркас
             набран по минимальному составу обложки: если у патча пересказ
             найдётся, текст поедет ВВЕРХ на одну строку, а это заметно мягче,
             чем если бы он ехал вниз с нарисованного места.
          2. Второй колонки под кадр патча нет по той же причине, что и в самой
             обложке она условная: у 550 обновлений из 1163 своей картинки нет.
             Заглушка, которая потом исчезает, читается как сбой; место,
             которое потом занимает картинка, — как обычная загрузка.

          Высоты сверены замером с живой обложкой: 17+16, 16+16, 105, 20+28,
          32+54 — ровно 303 px колонки.
        */}
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-20 pt-40 md:pb-28">
          <div className="grid gap-10">
            <div>
              {/* «— Что нового · в твоих играх» */}
              <div className="mb-4 flex items-center gap-x-3">
                <span aria-hidden className="h-px w-10 bg-rule" />
                <Skel className="h-[17px] w-[11rem] rounded-[4px]" />
              </div>
              {/* дата и студия */}
              <Skel className="mb-4 h-4 w-[15rem] rounded-[4px]" delay={70} />
              {/* название игры */}
              <Skel className="h-[105px] w-[min(100%,30rem)]" delay={140} />
              {/* заголовок патча */}
              <Skel className="mt-5 h-7 w-[min(100%,24rem)] rounded-[6px]" delay={210} />
              {/* счётчики: онлайн и число правок */}
              <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
                {[0, 1].map((i) => (
                  <span key={i} className="flex flex-col">
                    <Skel className="h-9 w-[6rem] rounded-[6px]" delay={380 + i * 70} />
                    <Skel className="mt-0.5 h-4 w-[9rem] rounded-[4px]" delay={420 + i * 70} />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* строки ленты под обложкой */}
      <div className="mx-auto w-full max-w-6xl px-5 pb-24">
        <div className="flex items-baseline justify-between gap-6 border-b border-rule py-6">
          <Skel className="h-6 w-[16rem] rounded-[6px]" delay={520} />
          <Skel className="hidden h-4 w-[18rem] rounded-[4px] md:block" delay={560} />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-5 border-b border-rule py-6">
            <Skel className="aspect-[460/215] w-[128px] shrink-0 rounded-[10px]" delay={600 + i * 90} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skel className="h-3 w-[8rem] rounded-[4px]" delay={640 + i * 90} />
              <Skel className="h-5 w-[min(100%,22rem)] rounded-[6px]" delay={680 + i * 90} />
              <Skel className="h-4 w-[min(100%,30rem)] rounded-[4px]" delay={720 + i * 90} />
            </div>
          </div>
        ))}
      </div>
    </SkelPage>
  )
}
