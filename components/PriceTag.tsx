import type { Discount } from '@/lib/discount'
import { formatPrice, notSold, priceWhere } from '@/lib/steamregion'

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
 *
 * Регион — тоже с сервера и рядом с ценой (cc): валюта — свойство замера, а
 * не страницы. Карточка, отданная до смены STEAM_STORE_CC, рисует свои
 * доллары долларами, а не долларами со знаком рубля.
 */

export type PriceTagProps = {
  /** цена в минимальных единицах валюты; null — цена неизвестна */
  priceFinal: number | null
  /**
   * Регион магазина, в котором снята цена (lib/steamregion). Обязателен:
   * без него у цены нет валюты. null — региона нет, а значит, и цены: кроме
   * «бесплатно», ничего не рисуется.
   */
  cc: string | null
  /** Магазин региона игру не показывает — «не продаётся в российском Steam» */
  unsold?: boolean | null
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
  cc,
  unsold = false,
  discount = null,
  isFree = false,
  size = 'inline',
  showPercent = true,
  className = '',
}: PriceTagProps) {
  // «Не продаётся» сильнее даже «бесплатно»: бесплатную игру, которую магазин
  // региона не показывает, из него тоже не взять, и «бесплатно» обещало бы
  // человеку то, чего он не получит. Так же решает разметка (offersOf в
  // lib/jsonld: у скрытой игры Offer нет, даже нулевого) — видимое и
  // размеченное не расходятся. Факт, а не ошибка: тем же тоном, что цена, но
  // без акцента — купить здесь нечего. Без региона сказать «где» нечем, и
  // такой ответ молчит, как цена без валюты
  if (unsold && cc) return <span className={`text-dim ${className}`}>{notSold(cc)}</span>
  if (isFree || priceFinal === 0) {
    return <span className={`font-bold tabular-nums text-ember-text ${className}`}>бесплатно</span>
  }
  // cc === undefined — карточка из вкладки, открытой до этого поля: валюты у
  // её цены не узнать, и она молчит так же, как без региона
  if (cc === null || cc === undefined) return null
  if (priceFinal === null || priceFinal === undefined) return null

  const hero = size === 'hero'
  const price = formatPrice(discount ? discount.finalCents : priceFinal, cc)

  if (!discount) {
    return <span className={`font-bold tabular-nums text-ember-text ${className}`}>{price}</span>
  }

  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      {showPercent && (
        <span
          className={`rounded-full bg-ember/15 text-ember-text tabular-nums font-semibold ${
            hero ? 'px-2 py-0.5 text-sm' : 'px-1.5 py-0.5 text-[11px]'
          }`}
        >
          −{discount.percent}%
        </span>
      )}
      {/* Старая цена приглушена намеренно: это история, а не второй ценник */}
      <span className="tabular-nums text-faint line-through">
        {formatPrice(discount.initialCents, cc)}
      </span>
      <span className={`font-bold tabular-nums text-ember-text ${hero ? 'text-base' : ''}`}>
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
    <span className="absolute left-2 top-2 rounded-full bg-ember px-2 py-0.5 tabular-nums text-[11px] font-bold text-on-ember shadow-lg">
      −{discount.percent}%
    </span>
  )
}

/**
 * «цена в российском Steam» — мелкой строкой у ценника, где для неё есть
 * место (герой /play и /daily, карточка игры).
 *
 * Не у каждой плитки: регион у всех цен страницы один, и подпись под каждой
 * из двенадцати была бы шумом. Нужна она там, где человек решает купить:
 * русскоязычный аккаунт — не обязательно российский (у KZ и СНГ-доллара
 * цены другие), и число без региона обещало бы ему чужую цену.
 */
export function PriceWhere({ cc, className = '' }: { cc: string | null | undefined; className?: string }) {
  if (!cc) return null
  return <span className={`text-xs text-faint ${className}`}>{priceWhere(cc)}</span>
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
