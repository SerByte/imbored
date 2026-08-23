import { Skel, SkelPage } from '@/components/Skeleton'

/**
 * Каркас портрета игрока.
 *
 * Класс media-dark обязателен — по той же причине, что и .whatsnew у соседнего
 * фолбэка: без него кадр ожидания рендерится ВНЕ зоны, и на светлой теме между
 * двумя почти чёрными экранами вспыхивает молочный лист, а шапка успевает
 * перекраситься на полпути (см. правило :has(.media-dark) в globals.css).
 *
 * Портрет — самая тяжёлая страница приложения: она читает библиотеку целиком,
 * считает итоги года и собирает мозаику из обложек. Экран ожидания здесь живёт
 * дольше всего, и просто дуга в центре была тут особенно бедной.
 */
export default function PortraitLoading() {
  return (
    <SkelPage className="flex-1">
      <section
        className="media-dark media-full relative flex flex-col justify-end overflow-hidden"
        style={{ minHeight: '100svh' }}
      >
        {/* мозаика обложек за текстом — тремя рядами, как в самой странице */}
        <div aria-hidden className="absolute inset-0 flex flex-col opacity-40">
          {[4, 5, 6].map((cols, row) => (
            <div key={cols} className="flex flex-1 gap-px">
              {Array.from({ length: cols }, (_, i) => (
                <Skel key={i} className="flex-1 rounded-none" delay={row * 120 + i * 60} />
              ))}
            </div>
          ))}
        </div>
        <div aria-hidden className="grain" />

        {/*
          Обложка выровнена по низу, поэтому каждый недостающий пиксель
          поднимает имя игрока. Высоты сняты замером с живой страницы:
          16+12 надзаголовок, 105 имя, 32+58 тройка чисел, 24+24 строка
          «столько-то полных суток за экраном».
        */}
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-40">
          <Skel className="h-4 w-[10rem] rounded-[4px] mb-3" delay={120} />
          <Skel className="h-[105px] w-[min(100%,28rem)]" delay={190} />
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col">
                <Skel className="h-10 w-[5.5rem] rounded-[6px]" delay={300 + i * 60} />
                <Skel className="mt-0.5 h-4 w-[7.5rem] rounded-[4px]" delay={340 + i * 60} />
              </div>
            ))}
          </div>
          <Skel className="mt-6 h-6 w-[min(100%,20rem)] rounded-[4px]" delay={500} />
        </div>
      </section>
    </SkelPage>
  )
}
