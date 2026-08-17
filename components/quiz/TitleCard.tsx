'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useEffect, useRef } from 'react'
import { TITLE } from '@/lib/motion'

/**
 * Титульная карточка входа в квиз: темнота — розжиг лампы — вспышка — комната.
 *
 * Один раз за сессию, ~880 мс, гасится любым касанием или клавишей.
 *
 * position: absolute, А НЕ fixed. app/template.tsx вешает на обёртку страницы
 * .anim-page-in, которая двигает translateY(4px); transform на предке создаёт
 * содержащий блок для fixed-потомков, и карточка резолвилась бы относительно
 * ЭТОЙ анимируемой обёртки: 4px мимо первые 180 мс, а шапка сайта оставалась бы
 * полностью освещённой в такте «полная темнота». Корень квиза и так relative,
 * overflow-hidden и во весь экран, а последнее место в разметке кладёт карточку
 * поверх всего без единого z-index.
 *
 * ЧЕТЫРЕ НЕЗАВИСИМЫЕ ГАРАНТИИ, что сбой не оставит человека перед чёрным экраном
 * (закон проекта: анимация может только добавить проявление, но не спрятать):
 *
 * 1. СТРУКТУРНАЯ. Карточка рендерится только после клиентского эффекта. В
 *    серверном HTML чёрного оверлея нет вовсе — умер JS раньше, карточки просто
 *    не существует.
 * 2. ПЛАШКОЙ ВЛАДЕЕТ CSS. Ключевые кадры без fill-mode, дословно логика
 *    .anim-page-in: базовое состояние прозрачно, а CSS-анимация не может
 *    застрять наполовину и не может пережить свою длительность.
 * 3. immediateRender: false НА КАЖДОМ .from(). По умолчанию gsap.from()
 *    применяет исходное состояние в момент СБОРКИ таймлайна — то есть
 *    opacity: 0 мгновенно лёг бы на элементы, и пропуск, гасящий только
 *    оверлей, оставил бы их невидимыми навсегда. Это самая вероятная поломка
 *    во всей затее, причём ровно на рекламируемой возможности.
 * 4. ЖЁСТКИЙ ТАЙМЕР ВНЕ GSAP. Та же идиома и та же причина, что у router.push
 *    в квизе и у бэкстопа CountNumber.
 *
 * Звука здесь нет и быть не может: AudioContext не стартует до жеста человека,
 * а на первом заходе жеста ещё не было — «гудение лампы» физически оказалось бы
 * тишиной. Такт закрыт светом.
 */
export function TitleCard({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // Родитель отдаёт стрелку, то есть новую функцию на каждый рендер. Держим её
  // в рефе, чтобы таймлайн и таймеры не пересобирались из-за этого — но пишем
  // ref в эффекте, а не в рендере.
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  }, [onDone])

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return

      const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)
      const filament = q('[data-title-filament]')
      const flare = q('[data-title-flare]')
      // Створки живут в КОМНАТЕ, снаружи карточки. Передаём элементами, а не
      // строкой: строковый селектор gsap ограничен областью видимости scope.
      const shutters = Array.from(
        el.closest('.quiz-room')?.querySelectorAll<HTMLElement>('[data-answer]') ?? [],
      )

      const tl = gsap.timeline()

      /*
       * Сомкнутое состояние задаёт GSAP, а не CSS, и это пятая гарантия против
       * чёрного экрана: без JS створки просто стоят открытыми. Обратное —
       * сомкнуть их стилем и разжимать скриптом — оставило бы человека перед
       * пустой комнатой, если скрипт не отработает.
       *
       * clip-path, а не scaleX: затвор ОТКРЫВАЕТ кадр, а не растягивает его.
       * Масштаб исказил бы арт и подпись, обрезка — нет.
       */
      if (shutters.length) {
        tl.set(shutters, { clipPath: 'inset(0% 50% 0% 50%)' }, 0).to(
          shutters,
          {
            clipPath: 'inset(0% 0% 0% 0%)',
            duration: TITLE.openDur,
            ease: 'power4.out',
            // от центра наружу: свет расходится из середины кадра
            stagger: { each: TITLE.openStagger, from: 'center' },
          },
          TITLE.openAt,
        )
      }

      if (filament) {
        tl.fromTo(
          filament,
          { scaleX: 0.04, opacity: 0 },
          {
            scaleX: 1,
            opacity: 1,
            duration: TITLE.strikeDur,
            ease: 'power4.out',
            immediateRender: false,
          },
          TITLE.strikeAt,
        )
          // Волосок расплывается — лампа выходит на режим
          .to(
            filament,
            { scaleY: 3, opacity: 0.7, duration: 0.12, ease: 'power2.out' },
            TITLE.strikeAt + TITLE.strikeDur,
          )
          .to(filament, { scaleX: 1.4, opacity: 0, duration: 0.2, ease: 'power2.out' }, 0.3)
      }

      if (flare) {
        tl.fromTo(
          flare,
          { opacity: 0 },
          { opacity: 0.55, duration: TITLE.flareDur, ease: 'power4.out', immediateRender: false },
          TITLE.flareAt,
        ).to(
          flare,
          { opacity: 0, duration: 0.2, ease: 'power2.inOut' },
          TITLE.flareAt + TITLE.flareDur,
        )
      }

      const skip = () => {
        // Каждый содержательный такт — from/fromTo, поэтому progress(1)
        // приземляет всё в естественное состояние покоя, а не в исходное.
        tl.progress(1).kill()
        done.current()
      }
      window.addEventListener('pointerdown', skip, { once: true })
      window.addEventListener('keydown', skip, { once: true })

      return () => {
        window.removeEventListener('pointerdown', skip)
        window.removeEventListener('keydown', skip)
        tl.kill()
        // Обрыв не имеет права оставить створки полузакрытыми.
        if (shutters.length) gsap.set(shutters, { clearProps: 'clipPath' })
      }
    },
    { scope: ref },
  )

  /**
   * Уход из DOM живёт на голых таймерах, а не на onComplete таймлайна: если
   * анимация не отработает (скрытая вкладка, задушенный rAF, сбой плагина),
   * карточка обязана уйти всё равно.
   */
  useEffect(() => {
    const a = window.setTimeout(() => done.current(), TITLE.unmountMs)
    const b = window.setTimeout(() => done.current(), TITLE.hardMs)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [])

  return (
    <div ref={ref} aria-hidden className="quiz-titlecard absolute inset-0">
      {/* Плашки нет: темнота — это сами сомкнутые створки. Здесь остаются
          только волосок лампы и её вспышка. Порядок разметки = порядок слоёв. */}
      <span data-title-flare className="title-flare" />
      <span data-title-filament className="title-filament" />
    </div>
  )
}
