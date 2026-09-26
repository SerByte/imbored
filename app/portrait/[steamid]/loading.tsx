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
 * считает итоги и собирает стену постеров. Экран ожидания здесь живёт дольше
 * всего, поэтому он повторяет саму страницу: повёрнутая стена постеров
 * (.portrait-wall) под тем же затемнением, ник и тройка крупных чисел.
 */
export default function PortraitLoading() {
  return (
    <SkelPage className="flex-1">
      <section
        className="media-dark media-full relative flex flex-col justify-end overflow-hidden"
        style={{ minHeight: '100svh' }}
      >
        <div aria-hidden className="portrait-wall">
          {Array.from({ length: 32 }, (_, i) => (
            <Skel key={i} className="portrait-wall-cell" delay={(i % 8) * 60 + Math.floor(i / 8) * 90} />
          ))}
        </div>
        {/* то же затемнение, что у страницы: стена гаснет к тексту */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, #050505 6%, rgba(5,5,5,0.86) 30%, rgba(5,5,5,0.45) 62%, rgba(5,5,5,0.5) 100%)',
          }}
        />
        <div aria-hidden className="grain" />

        {/*
          Обложка выровнена по низу, поэтому каждый недостающий пиксель
          поднимает имя игрока. Высоты сняты замером с живой страницы, телефон
          390 и десктоп 1280: 16 надзаголовок, имя 47 и 92, числа 142 и 83
          (на телефоне третье число переносится), строка про сутки 20 и 24.
        */}
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
          <Skel className="mt-6 h-5 w-[min(100%,20rem)] rounded-[4px] md:h-6" delay={500} />
        </div>
      </section>
    </SkelPage>
  )
}
