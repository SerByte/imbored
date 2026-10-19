import { Skel, SkelPage, SkelTile } from '@/components/Skeleton'

/**
 * Каркас библиотеки.
 *
 * Здесь он нужнее, чем где бы то ни было: страница force-dynamic, за ней
 * поход в Steam за всей библиотекой и в базу за метаданными сотен игр, и до
 * этой правки всё это время в центре пустого экрана крутилась дуга — а потом
 * в неё разом влетала стена из сотен обложек.
 *
 * Геометрия повторяет app/library/page.tsx буквально: тот же герой (.lib-hero
 * в кино-зоне), та же обёртка max-w-6xl px-5, та же сетка 2/4 колонки, та же
 * капсула 460×215 с подписью под ней. Каркас, который не совпадает с содержимым, устраивает ровно тот
 * сдвиг вёрстки, ради избавления от которого его и ставят.
 *
 * Двенадцать плиток — ровно три ряда на широком экране: столько помещается
 * выше сгиба. Рисовать их сотнями незачем — ниже сгиба каркас не видит никто,
 * а разметка не бесплатна.
 */
export default function LibraryLoading() {
  return (
    <SkelPage className="flex-1 flex flex-col">
      {/*
        Герой — той же высоты и в той же кино-зоне, что настоящий (.lib-hero):
        подмена каркаса содержимым не должна сдвигать ни заголовок, ни числа.
        Мозаики в каркасе нет — это картинки, а не раскладка.
      */}
      <div className="media-dark lib-hero relative">
        <div className="relative mx-auto w-full max-w-6xl px-5 pt-32 pb-12 md:pb-16">
          <Skel className="h-[17px] w-[7rem] rounded-[4px] mb-3" />
          <Skel className="h-[46px] w-[min(100%,24rem)]" delay={70} />
          <Skel className="mt-2 h-[46px] w-[min(100%,18rem)]" delay={110} />
          <div className="mt-7 flex flex-wrap gap-x-10 gap-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col">
                <Skel className="h-[48px] w-[5.5rem] rounded-[8px]" delay={160 + i * 60} />
                <Skel className="mt-2 h-4 w-[6.5rem] rounded-[4px]" delay={200 + i * 60} />
              </div>
            ))}
          </div>
          {/* строка «с прошлого снимка» — обычно две строки текста */}
          <Skel className="mt-5 h-[46px] w-[min(100%,28rem)] rounded-[4px]" delay={340} />
          {/* две кнопки: портрет и «Полистать» — на телефоне встают друг под другом */}
          <div className="mt-8 flex flex-wrap gap-3">
            <Skel className="h-[48px] w-[14rem] rounded-[11px]" delay={380} />
            <Skel className="h-[48px] w-[17rem] rounded-[11px]" delay={420} />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 pt-10 pb-16">
        {/* карточка бэклога */}
        <div className="grid md:grid-cols-2 gap-4 mb-10">
          <div className="panel-lift p-5 flex flex-col">
            <Skel className="h-7 w-2/3 rounded-[6px]" delay={420} />
            <Skel className="mt-1 h-4 w-1/2 rounded-[4px]" delay={470} />
            <Skel className="mt-2 h-4 w-2/5 rounded-[4px]" delay={520} />
          </div>
        </div>

        {/* полка «Ты забыл, что они у тебя есть» — сетка та же, что в page.tsx */}
        <section className="mb-12">
          <Skel className="h-[17px] w-[9rem] rounded-[4px] mb-2" delay={560} />
          <Skel className="h-[33px] w-[min(100%,22rem)] mb-1.5" delay={600} />
          <Skel className="h-5 w-[min(100%,32rem)] rounded-[4px] mb-4" delay={640} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkelTile key={i} delay={680 + i * 60} />
            ))}
          </div>
        </section>

        {/* пилюли фильтров */}
        <div className="flex flex-wrap gap-2 mb-6">
          {[4.6, 9, 9.2, 8.2, 8.4].map((w, i) => (
            <Skel key={i} className="h-[38px] rounded-full" style={{ width: `${w}rem` }} delay={960 + i * 50} />
          ))}
        </div>

        {/* стена */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-6">
          {Array.from({ length: 12 }, (_, i) => (
            <SkelTile key={i} delay={1210 + i * 45} caption={2} />
          ))}
        </div>
      </div>
    </SkelPage>
  )
}
