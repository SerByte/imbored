import { Skel, SkelPage } from '@/components/Skeleton'

/**
 * Каркас итогов года. Без своего файла здесь стоял бы каркас портрета —
 * герой во весь экран и три числа, — и при подмене имя прыгало бы вверх:
 * герой итогов ниже (80svh). Та же стена постеров под тем же затемнением,
 * надзаголовок, имя, числа и строка с датами. media-dark — по той же
 * причине, что у портрета: без неё на светлой теме вспыхивает молочный лист.
 */
export default function YearLoading() {
  return (
    <SkelPage className="flex-1">
      <section className="media-dark relative flex min-h-[80svh] flex-col justify-end overflow-hidden">
        <div aria-hidden className="portrait-wall">
          {Array.from({ length: 32 }, (_, i) => (
            <Skel key={i} className="portrait-wall-cell" delay={(i % 8) * 60 + Math.floor(i / 8) * 90} />
          ))}
        </div>
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, #050505 8%, rgba(5,5,5,0.88) 34%, rgba(5,5,5,0.5) 66%, rgba(5,5,5,0.55) 100%)',
          }}
        />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto w-full max-w-6xl px-safe pb-16 pt-40">
          <Skel className="mb-3 h-4 w-[10rem] rounded-[4px]" delay={120} />
          <Skel className="h-[47px] w-[min(100%,28rem)] md:h-[92px]" delay={190} />
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col">
                <Skel className="h-9 w-[5.5rem] md:h-14" delay={300 + i * 60} />
                <Skel className="mt-1.5 h-[21px] w-[7.5rem] rounded-[4px]" delay={340 + i * 60} />
              </div>
            ))}
          </div>
          <Skel className="mt-6 h-5 w-[min(100%,22rem)] rounded-[4px]" delay={500} />
        </div>
      </section>
    </SkelPage>
  )
}
