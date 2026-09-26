import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Подпись выбора, которым можно поделиться (/pick/<id>), и непрозрачный id.
 *
 * ПОДПИСЬ — ПОТОМУ ЧТО ПИСАТЬ МОЖЕТ ЛЮБОЙ. Пишущую сессию выдаёт даром и
 * демо-вход, и роут, принимающий от клиента {appid, текст}, публиковал бы
 * под нашим именем и с нашей карточкой в чате любой текст: фишинг и спам на
 * imbored.cc/pick/…. Поэтому текст подписывает сервер в момент, когда сам
 * его выдал (/api/recommend, /api/daily), а /api/pick сохраняет только то,
 * что совпало с подписью для ТЕКУЩЕЙ сессии.
 *
 * В сообщении steamid — подпись нельзя перенести на чужой аккаунт; источник
 * — «из своей библиотеки» и «из магазина» не подделать; версия — чтобы
 * сменить формат, не приняв старых подписей за новые.
 *
 * Отдельный модуль по той же причине, что lib/roomkey: node:crypto не едет в
 * клиентскую сборку. Секрет приходит аргументом.
 */

export type PickShareFields = { steamid: string; appid: number; source: string; text: string }

const SIG_LEN = 22

export function pickShareSig(secret: string, v: PickShareFields): string {
  return createHmac('sha256', secret)
    .update(`pick:v1:${v.steamid}:${v.appid}:${v.source}:${v.text}`)
    .digest('base64url')
    .slice(0, SIG_LEN)
}

/** Сравнение за постоянное время; мусор вместо подписи — false, а не исключение */
export function pickShareOk(secret: string, v: PickShareFields, sig: unknown): boolean {
  if (typeof sig !== 'string' || sig.length !== SIG_LEN) return false
  const want = Buffer.from(pickShareSig(secret, v))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

/**
 * Двенадцать знаков из тридцати одного — около 2^59: перебором не найти, в
 * отличие от кода комнаты (шесть знаков, 2^30). Строчные и без похожих
 * (0/o, 1/l/i): ссылку диктуют и перепечатывают.
 */
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const ID_LEN = 12

export function newPickId(): string {
  let id = ''
  for (let i = 0; i < ID_LEN; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)]
  return id
}

/**
 * Поле share у героя выдачи — текст, который можно отправить, и подпись к
 * нему. Отдаётся только героям (/play, /daily): открытия героем не
 * становятся, и делиться ими нечем. Текст приходит уже без денег
 * (lib/sharedpick shareText).
 */
export function shareView(
  secret: string,
  v: PickShareFields,
): { share?: { text: string; sig: string } } {
  // Пустой текст (всё объяснение было про цену, см. shareText) — кнопки нет
  if (!v.text.trim()) return {}
  return { share: { text: v.text, sig: pickShareSig(secret, v) } }
}
