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
 * кадр на то, чтобы выглядеть живым. Раскладка — та же, что у шапки страницы:
 * две ленты постеров (CoverWall), надзаголовок, «Имя × Имя», вердикт и ряд
 * чисел с крупным процентом. Кольца на 200 px больше нет ни там, ни здесь.
 *
 * Высоты сняты замером с живой страницы, телефон 390 и десктоп 1280:
 * 16 надзаголовок, имя 81 и 66, вердикт 63 и 42, ряд чисел 179 и 145
 * (на телефоне процент — отдельной строкой, два числа под ним).
 */
export default function CompatLoading() {
  return (
    <SkelPage className="flex-1">
      <section
        className="media-dark media-full relative flex flex-col justify-end overflow-hidden"
        style={{ minHeight: '88svh' }}
      >
        <div aria-hidden className="pwall cwall">
          <div className="pwall-grid">
            {[0, 1].map((row) => (
              <div key={row} className="pwall-row">
                {Array.from({ length: 20 }, (_, i) => (
                  <Skel key={i} className="cwall-poster" delay={(i % 10) * 60 + row * 120} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div aria-hidden className="cwall-scrim" />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto w-full max-w-6xl px-safe pb-16 pt-40">
          <Skel className="mb-3 h-4 w-[9rem] rounded-[4px]" delay={80} />
          {/* «Имя × Имя» */}
          <Skel className="h-[81px] w-[min(100%,26rem)] md:h-[66px]" delay={150} />
          {/* вердикт */}
          <Skel className="mt-4 h-[63px] w-[min(100%,20rem)] md:h-[42px]" delay={220} />
          {/* процент крупно и два числа рядом — как dl страницы */}
          <div className="mt-10 flex flex-wrap items-end gap-x-10 gap-y-6 md:gap-x-12">
            <div className="flex basis-full flex-col md:basis-auto">
              <Skel className="h-[65px] w-[9rem] md:h-[118px] md:w-[14rem]" delay={290} />
              <Skel className="mt-1.5 h-[21px] w-[10rem] rounded-[4px]" delay={330} />
            </div>
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col">
                <Skel className="h-9 w-16 md:h-14" delay={360 + i * 60} />
                <Skel className="mt-1.5 h-[21px] w-[6rem] rounded-[4px]" delay={400 + i * 60} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </SkelPage>
  )
}
