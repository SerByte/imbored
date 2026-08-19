import { parseProfileInput, type ProfileInput } from './steam'

/**
 * Разбор того, что человек вставил в поле «ссылка друга» на хабе
 * «Совместимость».
 *
 * Почему не хватило parseProfileInput. Он умеет профили Steam, но осознанно
 * режет любые чужие домены (иначе поле входа стало бы приёмником произвольных
 * ссылок). А самый частый случай здесь — НАША же ссылка вида
 * imbored.cc/compat/765…: именно её человеку и присылают, именно её он
 * скопирует из чата. Поэтому свой домен разбираем сами, а всё остальное
 * отдаём вниз, не ослабляя тамошнюю проверку.
 *
 * Порядок веток важен: compat-ссылку надо поймать ДО parseProfileInput,
 * который на ней вернул бы null из-за слэшей.
 */

const STEAMID64_RE = /^\d{17}$/

/**
 * Путь /compat/<17 цифр> с любым хостом или вовсе без него.
 *
 * Хост не сверяем со своим намеренно: превью-деплой, локалка и голый путь —
 * это всё та же ссылка, а ошибиться тут можно только в свою сторону. Ценность
 * строгости нулевая: из адреса мы забираем ровно семнадцать цифр и больше
 * ничего, никуда по нему не ходим.
 */
const COMPAT_PATH_RE = /(?:^|\/)compat\/(\d{17})(?:[/?#]|$)/

export function parseCompatInput(raw: string): ProfileInput | null {
  const input = raw.trim()
  if (!input) return null

  const compat = input.match(COMPAT_PATH_RE)
  if (compat?.[1] && STEAMID64_RE.test(compat[1])) {
    return { kind: 'steamid64', value: compat[1] }
  }

  return parseProfileInput(input)
}
