import { PriceTag } from '@/components/PriceTag'
import type { Discount } from '@/lib/discount'

/** Что нужно строкам владения — подмножество matchedGame комнаты */
export type MatchOwnersGame = {
  appid: number
  store: string | null
  storeUrl: string | null
  /** есть ли игра у смотрящего; null — не знаем (снапшота нет) */
  ownedByMe?: boolean | null
  /**
   * У кого из ОСТАЛЬНЫХ её нет — метками ростера (missingNames в lib/room).
   * null и отсутствие — не знаем: смотрит не участник или старый сервер.
   */
  missingFor?: string[] | null
  isFree?: boolean
  priceFinal?: number | null
  priceCc?: string | null
  unsold?: boolean
  discount?: Discount | null
}

/**
 * Кому сошедшейся игры не хватает — строками под главной кнопкой церемонии.
 *
 * Колода сознательно берёт игры «не у всех», и матч бывает на игре, которой у
 * кого-то нет. Церемония говорила об этом одному ему — «У тебя её пока нет», —
 * а остальные видели «Это матч!», звали в войс и ждали. Пати вставала, едва
 * договорившись. Теперь видят все: «Нет у: Дима, Саша» — те же метки, что
 * колода и так пишет на каждой карте, ничего сверх них.
 *
 * Три строки, и каждая — только когда правда:
 *   • «У тебя её пока нет · цена» — смотрящему, у которого нет (как было);
 *   • «Нет у: Дима, Саша · цена» — про остальных. Если нет и у смотрящего,
 *     «Тоже нет у» и без второй цены: она уже стоит строкой выше;
 *   • «Подарить — в магазине Steam» — владельцу, когда другим не хватает:
 *     на странице игры в магазине есть «Купить в подарок». Тихая ссылка, а не
 *     кнопка: это возможность, а не то, чего от него ждут. Не для бесплатной
 *     (её не дарят — её берут), не для той, что магазин региона не продаёт, и
 *     не для игры другого магазина — подарок там свой, и Steam его не знает.
 *
 * Без глаголов с родом: «Нет у: …», как на картах колоды, — ник не говорит,
 * «он» или «она» за ним.
 */
export function MatchOwners({ game }: { game: MatchOwnersGame }) {
  const others = game.missingFor ?? []
  const meLacks = game.ownedByMe === false
  if (!meLacks && others.length === 0) return null

  // Разделитель — только когда ценник что-то скажет: без него « · » повис бы
  // в конце. Условие — то же, при котором PriceTag не молчит. Прежнее «цена не
  // null» пропускало цену без региона (старая строка каталога, price_cc нет):
  // PriceTag такую не рисует, а точка оставалась висеть
  const cc = game.priceCc ?? null
  const priceFinal = game.priceFinal ?? null
  const price =
    game.isFree || priceFinal === 0 || (cc !== null && (game.unsold || priceFinal !== null)) ? (
      <>
        {' · '}
        <PriceTag
          priceFinal={priceFinal}
          cc={cc}
          unsold={game.unsold}
          isFree={game.isFree}
          discount={game.discount}
        />
      </>
    ) : null

  const gift =
    game.ownedByMe === true &&
    others.length > 0 &&
    !game.storeUrl &&
    game.appid > 0 &&
    !game.isFree &&
    !game.unsold

  return (
    <>
      {meLacks && <p className="text-sm text-dim">У тебя её пока нет{price}</p>}
      {others.length > 0 && (
        <p className="text-sm text-dim">
          {`${meLacks ? 'Тоже нет у' : 'Нет у'}: `}
          <span className="text-ink">{others.join(', ')}</span>
          {meLacks ? null : price}
        </p>
      )}
      {gift && (
        <a
          href={`https://store.steampowered.com/app/${game.appid}/`}
          target="_blank"
          rel="noreferrer"
          className="tap text-sm text-dim hover:text-ink transition-colors"
        >
          Подарить — в магазине Steam
        </a>
      )}
    </>
  )
}
