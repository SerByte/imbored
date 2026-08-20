import { Skel, SkelPage } from '@/components/Skeleton'

/**
 * Каркас страницы игры.
 *
 * Маршрут прегенерирован не весь: у игры, которой нет в сборке, страница
 * собирается на запросе — с походом в Steam за метаданными, отзывами и
 * скриншотами. Именно там этот экран и виден.
 *
 * Сетка [380px_1fr] и пропорция обложки 460×215 повторяют app/game/[appid],
 * поэтому обложка приезжает ровно на своё место, а не сдвигает вниз весь
 * правый столбец.
 */
export default function GameLoading() {
  return (
    <SkelPage className="flex-1">
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-5xl px-5 pt-28 pb-10 grid md:grid-cols-[380px_1fr] gap-8 items-start">
          <Skel className="w-full aspect-[460/215] rounded-[20px]" />

          {/*
            Правый столбец набран по замеру живой страницы: 71 (название) + 56
            (кольцо отзывов) + 60 (теги в два ряда) + 104 (описание в четыре
            строки) + 96 (кнопки в два ряда) при gap-4 между блоками.

            Описание и число тегов у каждой игры свои, поэтому точного
            совпадения тут не бывает в принципе — взят типичный состав:
            короткое описание из Steam на ширине 572 px это как раз три-пять
            строк. Столбец выровнен по ВЕРХУ, так что расхождение сдвигает
            только то, что ниже героя, а обложка и название стоят намертво.
          */}
          <div className="flex flex-col gap-4">
            {/* название */}
            <Skel className="h-[71px] w-[min(100%,24rem)]" delay={70} />
            {/* кольцо отзывов и подпись рядом */}
            <div className="flex items-center gap-3.5">
              <Skel className="size-14 rounded-full shrink-0" delay={140} />
              <div className="flex flex-col gap-1.5">
                <Skel className="h-4 w-[11rem] rounded-[4px]" delay={175} />
                <Skel className="h-3 w-[14rem] rounded-[4px]" delay={210} />
              </div>
            </div>
            {/* теги — восемь штук, как и на живой странице, и так же в два ряда */}
            <div className="flex flex-wrap gap-2">
              {[4.5, 6, 5, 7, 4, 5.5, 5, 6].map((w, i) => (
                <Skel key={i} className="h-[26px] rounded-full" style={{ width: `${w}rem` }} delay={250 + i * 45} />
              ))}
            </div>
            {/* описание: четыре строки в 104 px — интерлиньяж leading-relaxed */}
            <div className="flex h-[104px] flex-col justify-between">
              <Skel className="h-4 w-full rounded-[4px]" delay={520} />
              <Skel className="h-4 w-[97%] rounded-[4px]" delay={560} />
              <Skel className="h-4 w-[92%] rounded-[4px]" delay={600} />
              <Skel className="h-4 w-[64%] rounded-[4px]" delay={640} />
            </div>
            {/* кнопки */}
            <div className="flex flex-wrap gap-3 mt-1">
              <Skel className="h-[42px] w-[12rem]" delay={690} />
              <Skel className="h-[42px] w-[11rem]" delay={730} />
              <Skel className="h-[42px] w-[13rem]" delay={770} />
            </div>
          </div>
        </div>
      </section>

      {/* «За что любят» / «За что ругают» */}
      <section className="mx-auto max-w-5xl px-5 pb-16 grid md:grid-cols-2 gap-4">
        {[0, 1].map((col) => (
          <div key={col} className="glass rounded-[20px] p-5 flex flex-col gap-3">
            <Skel className="h-4 w-[8rem] rounded-[4px]" delay={760 + col * 70} />
            {[0, 1, 2].map((i) => (
              <Skel key={i} className="h-4 w-full rounded-[4px]" delay={800 + col * 70 + i * 55} />
            ))}
          </div>
        ))}
      </section>
    </SkelPage>
  )
}
