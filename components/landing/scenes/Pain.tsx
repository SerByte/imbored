import { PainStage } from '@/components/landing/scenes/PainStage'
import { tr, type Locale } from '@/lib/i18n'

/**
 * СЦЕНА 2: ЗАЧЕМ ВСЁ ЭТО.
 *
 * Единственная сцена без единой картинки, и это её приём. Пока фразы титра
 * прилетают одна за другой, лента за ними ЗАМИРАЕТ И ОБЕСЦВЕЧИВАЕТСЯ —
 * «ничего не цепляет» показано фоном, а не сказано словами. Свет лентой правит
 * не отсюда: он считается одной шкалой от позиции прокрутки
 * (см. lib/ribbonlight.ts), и сцена только задаёт своими границами, где эта
 * перемена происходит.
 *
 * Компонент серверный: разметку и текст рисует сервер, а партитура (gsap)
 * живёт в клиентском PainStage и находит фразы по data-атрибутам. Так в
 * клиентский чанк главной уходит только партитура, а не текст обоих языков.
 * Язык — пропом от главной: контекст LocaleProvider серверу не прочитать.
 */
export function Pain({ locale }: { locale: Locale }) {
  const slate = tr(locale, { ru: 'Зачем всё это', en: 'Why this exists' })
  return (
    <PainStage label={slate}>
      {/* Свет комнаты и темнота, которая его съедает. Оба слоя — под текстом:
          гаснуть обязана комната, а не человек в ней. */}
      <div className="pain-key" aria-hidden data-pain-key />
      <div className="pain-shutter" aria-hidden data-pain-shutter />

      {/* Жёлоб с бегунком: он и есть «полистал». Замирает на «Закрыл.». */}
      <div className="pain-scroll" aria-hidden>
        <span className="pain-scroll-thumb" data-pain-thumb />
      </div>

      <p className="slate">
        <b>02</b>
        <span>{slate}</span>
      </p>

      {/* Три такта — три глагола: по-английски тот же ритм, «закрыл» бьёт последним */}
      <h2 className="pain-title font-display text-display-lg">
        <span data-pain-word>{tr(locale, { ru: 'Открыл Steam.', en: 'Opened Steam.' })}</span>
        <span data-pain-word>{tr(locale, { ru: 'Полистал.', en: 'Scrolled.' })}</span>
        <span data-pain-word className="text-ember-text">
          {tr(locale, { ru: 'Закрыл.', en: 'Closed it.' })}
        </span>
      </h2>

      <p className="scene-lede mt-8" data-pain-after>
        {tr(locale, {
          ru: 'Знакомо. Игр много, а зайти не во что.',
          en: 'Familiar? Lots of games, nothing to play.',
        })}
      </p>
    </PainStage>
  )
}
