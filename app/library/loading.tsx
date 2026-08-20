import { Skel, SkelPage, SkelTile } from '@/components/Skeleton'

/**
 * Каркас библиотеки.
 *
 * Здесь он нужнее, чем где бы то ни было: страница force-dynamic, за ней
 * поход в Steam за всей библиотекой и в базу за метаданными сотен игр, и до
 * этой правки всё это время в центре пустого экрана крутилась дуга — а потом
 * в неё разом влетала стена из сотен обложек.
 *
 * Геометрия повторяет app/library/page.tsx буквально: та же обёртка
 * max-w-6xl px-5 pt-28, та же сетка 2/4 колонки, та же пропорция обложки
 * 460×215. Каркас, который не совпадает с содержимым, устраивает ровно тот
 * сдвиг вёрстки, ради избавления от которого его и ставят.
 *
 * Двенадцать плиток — ровно три ряда на широком экране: столько помещается
 * выше сгиба. Рисовать их сотнями незачем — ниже сгиба каркас не видит никто,
 * а разметка не бесплатна.
 */
export default function LibraryLoading() {
  return (
    <SkelPage className="flex-1 mx-auto w-full max-w-6xl px-5 pt-28 pb-16">
      {/* титул и кнопка портрета */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <Skel className="h-[46px] w-[min(100%,26rem)]" />
        <Skel className="h-[38px] w-[13rem] shrink-0" delay={70} />
      </div>
      {/* строка-сводка: игр · часов · ни разу не запускал */}
      <Skel className="h-5 w-[19rem] max-w-full rounded-[4px] mb-6" delay={140} />

      {/*
        Карточки сводки. Высота набрана по частям настоящей карточки, а не
        одним числом: 28 (крупная строка) + 4 + 16 + 8 + 16 внутри p-5. Так
        она остаётся верной и когда у второй карточки строк меньше — высоту
        ряда в сетке всё равно задаёт первая.
      */}
      <div className="grid md:grid-cols-2 gap-4 mb-10">
        {[0, 1].map((i) => (
          <div key={i} className="glass rounded-[20px] p-5 flex flex-col">
            <Skel className="h-7 w-2/3 rounded-[6px]" delay={210 + i * 70} />
            <Skel className="mt-1 h-4 w-1/2 rounded-[4px]" delay={260 + i * 70} />
            <Skel className="mt-2 h-4 w-2/5 rounded-[4px]" delay={310 + i * 70} />
          </div>
        ))}
      </div>

      {/* полка «Ты забыл, что они у тебя есть» */}
      <section className="mb-12">
        <Skel className="h-[17px] w-[9rem] rounded-[4px] mb-2" delay={350} />
        <Skel className="h-[33px] w-[min(100%,22rem)] mb-1.5" delay={420} />
        <Skel className="h-5 w-[min(100%,32rem)] rounded-[4px] mb-4" delay={490} />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkelTile key={i} delay={560 + i * 60} />
          ))}
        </div>
      </section>

      {/* чипсы фильтров — ширины сняты с живых подписей «Все 22», «В бэклоге 8»… */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[4.2, 8.4, 8.6, 7.6, 7.6].map((w, i) => (
          <Skel key={i} className="h-[30px] rounded-full" style={{ width: `${w}rem` }} delay={860 + i * 50} />
        ))}
      </div>

      {/* стена */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 12 }, (_, i) => (
          <SkelTile key={i} delay={1110 + i * 45} caption={2} />
        ))}
      </div>
    </SkelPage>
  )
}
