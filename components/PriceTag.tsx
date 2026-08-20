import type { Discount } from '@/lib/discount'
import { formatPrice } from '@/lib/discount'

/**
 * Цена игры — с распродажей, если она идёт.
 *
 * Один компонент на все поверхности (герой подбора, карточки открытий,
 * страница игры) по той же причине, по которой SOURCE_BADGE живёт в lib:
 * цена рисовалась копипастой в пяти местах, и скидка, добавленная в четырёх
 * из них, выглядела бы не «неполной фичей», а ошибкой в пятом.
 *
 * Скидка приезжает уже посчитанной с сервера (см. discountView): решение
 * «верить ли этому замеру» принимается там, где известны часы и время
 * замера, а не в браузере.
 */

export type PriceTagProps = {
  /** цена в минимальных единицах валюты; null — цена неизвестна */
  priceFinal: number | null
  discount?: Discount | null
  isFree?: boolean | null
  /** «hero» — крупная плашка под кнопкой, «inline» — строка в карточке */
  size?: 'hero' | 'inline'
  /**
   * Показывать ли процент рядом с ценой. В плитках его уже несёт уголок на
   * обложке (DiscountCorner), и второй раз он не добавляет ничего, зато в
   * строке шириной с половину телефона вытесняет саму цену.
   */
  showPercent?: boolean
  className?: string
}

export function PriceTag({
  priceFinal,
  discount = null,
  isFree = false,
  size = 'inline',
  showPercent = true,
  className = '',
}: PriceTagProps) {
  if (isFree || priceFinal === 0) {
    return <span className={`font-mono tabular-nums text-ember-text ${className}`}>бесплатно</span>
  }
  if (priceFinal === null || priceFinal === undefined) return null

  const hero = size === 'hero'
  const price = formatPrice(discount ? discount.finalCents : priceFinal)

  if (!discount) {
    return <span className={`font-mono tabular-nums text-ember-text ${className}`}>{price}</span>
  }

  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      {showPercent && (
        <span
          className={`rounded-full bg-ember/15 text-ember-text font-mono font-semibold ${
            hero ? 'px-2 py-0.5 text-sm' : 'px-1.5 py-0.5 text-[11px]'
          }`}
        >
          −{discount.percent}%
        </span>
      )}
      {/* Старая цена приглушена намеренно: это история, а не второй ценник */}
      <span className="font-mono tabular-nums text-faint line-through">
        {formatPrice(discount.initialCents)}
      </span>
      <span className={`font-mono tabular-nums text-ember-text ${hero ? 'text-base font-semibold' : ''}`}>
        {price}
      </span>
    </span>
  )
}

/**
 * Уголок «−40%» поверх обложки: в плитке шириной в 11 пикселей текста для
 * тройки «процент, старая цена, новая» места нет, а скидку надо увидеть
 * раньше, чем прочитано название.
 *
 * Плашка ember, а не зелёная, как в Steam: зелёный в этой палитре занят
 * («есть у всех» в колоде пати, живой онлайн), и скидка, покрашенная так же,
 * означала бы в соседних блоках разные вещи одним цветом.
 *
 * text-on-ember, а НЕ text-bg. Это последнее место, куда не дошла разводка
 * ролевых токенов: --bg поверх заливки --ember даёт на светлой теме 2.85:1 —
 * ровно то число, из-за которого главная кнопка продукта когда-то была
 * нечитаемой. Уголок мельче кнопки (11 px) и стоит на обложке, то есть был
 * самым нечитаемым элементом продукта, а не просто одним из. Теперь эту
 * пару сторожит contrast.test.ts.
 */
export function DiscountCorner({ discount }: { discount: Discount | null | undefined }) {
  if (!discount) return null
  return (
    <span className="absolute left-2 top-2 rounded-full bg-ember px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-on-ember shadow-lg">
      −{discount.percent}%
    </span>
  )
}

/** «до 17 августа» — отдельно, потому что в карточке для неё нет места */
export function DiscountEnds({
  discount,
  className = '',
}: {
  discount: Discount | null | undefined
  className?: string
}) {
  if (!discount?.endsLabel) return null
  return <span className={`text-xs text-faint ${className}`}>{discount.endsLabel}</span>
}
