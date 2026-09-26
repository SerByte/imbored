import type { ReactNode } from 'react'

/**
 * ТРИ ПОДПИСИ ПРОДУКТА — и ровно три.
 *
 * До этого файла одна и та же роль набиралась по-разному в каждом файле, где
 * встречалась. Тег <h2> — то есть буквально один и тот же уровень заголовка —
 * рисовался тремя несвязанными способами: дисплейным начертанием, серой
 * строкой `text-sm font-medium` и моноширинным надзаголовком. У самих
 * надзаголовков нашлось семь значений трекинга (0.12, 0.14, 0.18, 0.2, 0.28,
 * 0.3, 0.42) и два кегля.
 *
 * Это не мелочь оформления. Подпись раздела — указатель: человек переходит с
 * /game на /play и на /rooms и должен УЗНАВАТЬ одно и то же указание. Пока
 * форма менялась от экрана к экрану, узнавать было нечего, и разметка
 * читалась собранной из кусков — чем она и была.
 *
 * Ролей действительно три, и различие между ними содержательное:
 *
 *   Eyebrow      — категория того, что идёт НИЖЕ: «СОВМЕСТИМОСТЬ»,
 *                  «ЗАПЕЧАТАННОЕ», «ЧИСТИЛИЩЕ». Стоит над крупным заголовком
 *                  и сам заголовком не является.
 *   SectionLabel — имя области страницы: «Скриншоты», «Что нового»,
 *                  «Открытые пати». Это и есть заголовок раздела, поэтому по
 *                  умолчанию <h2>.
 *   MetaLine     — строка фактов через разделитель: дата, число правок,
 *                  онлайн. Трекинг у неё вдвое уже, и это не разнобой: у
 *                  надзаголовка одно слово, которому разрядка идёт на пользу,
 *                  а здесь несколько значений в строку, и на 0.3em они
 *                  перестают читаться как отдельные.
 *
 * Тон называется по токену палитры, а не по настроению («accent», «muted»):
 * так на месте использования видно, какой именно цвет получится, и не нужно
 * держать в голове ещё один словарь поверх уже существующего.
 */

type Tone = 'ember' | 'dim' | 'faint' | 'ink'
type Tag = 'p' | 'h1' | 'h2' | 'h3' | 'span' | 'div' | 'figcaption'

const TONE: Record<Tone, string> = {
  ember: 'text-ember-text',
  dim: 'text-dim',
  faint: 'text-faint',
  ink: 'text-ink',
}

/**
 * Общая часть моноширинных подписей: кегль, регистр, начертание.
 *
 * Кегль и разрядка берутся ТОКЕНАМИ из app/globals.css, а не литералами. Это
 * не педантизм: форму подписей закрепили здесь, но кино-главная писала свои
 * надзаголовки прямо в CSS, мимо компонента, и разнобой завёлся заново — пять
 * значений разрядки при трёх кеглях. Пока число живёт в двух файлах, оно
 * разъедется в третий раз. Сторож — lib/tracking.test.ts.
 */
/*
 * «Премьера»: надзаголовок набран тем же гротеском, что и всё остальное, —
 * жирным капсом с разрядкой, как «ВО ЧТО ПОИГРАТЬ СЕГОДНЯ» над титром
 * стримингового героя. Моноширинный остался цифрам и кодам комнат.
 */
const LABEL = 'font-sans font-bold [font-size:var(--text-label)] leading-[1.3] uppercase'

/**
 * Те же классы строкой — для чужих тегов, на которые компонент не натянуть:
 * motion.p из framer-motion несёт свой набор пропсов, и заворачивать его ради
 * подписи значило бы добавлять уровень разметки на каждом экране портрета.
 * Источник у формы всё равно один — вот этот файл.
 */
export function eyebrow(tone: Tone = 'dim'): string {
  return `${LABEL} [letter-spacing:var(--track-eyebrow)] ${TONE[tone]}`
}

export function Eyebrow({
  children,
  tone = 'dim',
  as: Tag = 'p',
  className = '',
}: {
  children: ReactNode
  tone?: Tone
  as?: Tag
  className?: string
}) {
  return <Tag className={`${eyebrow(tone)} ${className}`}>{children}</Tag>
}

export function MetaLine({
  children,
  tone = 'dim',
  as: Tag = 'span',
  className = '',
}: {
  children: ReactNode
  tone?: Tone
  as?: Tag
  className?: string
}) {
  return <Tag className={`${LABEL} [letter-spacing:var(--track-meta)] ${TONE[tone]} ${className}`}>{children}</Tag>
}

export function SectionLabel({
  children,
  tone = 'ink',
  as: Tag = 'h2',
  className = '',
}: {
  children: ReactNode
  tone?: Tone
  as?: Tag
  className?: string
}) {
  return <Tag className={`section-title ${TONE[tone]} ${className}`}>{children}</Tag>
}

/**
 * Шапка раздела «Премьеры»: заголовок, необязательная строка под ним и
 * ссылка «Все →» справа. Так начинается каждая полка — как ряд в стриминге.
 */
export function SectionTitle({
  children,
  sub,
  action,
  as: Tag = 'h2',
  className = '',
}: {
  children: ReactNode
  sub?: ReactNode
  action?: ReactNode
  as?: Tag
  className?: string
}) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <Tag className="section-title">{children}</Tag>
        {sub ? <p className="mt-1.5 text-[15px] leading-snug text-dim">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0 text-sm font-bold text-dim">{action}</div> : null}
    </div>
  )
}
