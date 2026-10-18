import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { Locale } from './i18n'

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
 *
 * Язык текста — тоже в подписи (lang). Страница выбора говорит на языке
 * ссылки, и подпись английского текста не должна годиться русской ссылке, и
 * наоборот. Русский — без пометки в сообщении: так выглядели все подписи до
 * английской версии, и уже выданные (героям в открытых вкладках) проходят
 * как русские. Английский — свой префикс сообщения, а не хвост: хвост
 * совпал бы с русским текстом, который сам кончается тем же хвостом.
 */

export type PickShareFields = {
  steamid: string
  appid: number
  source: string
  text: string
  /** Язык текста; нет поля — русский, как у подписей до английской версии */
  lang?: Locale
}

const SIG_LEN = 22

function sigMessage(v: PickShareFields): string {
  const head = v.lang === 'en' ? 'pick:v1~en' : 'pick:v1'
  return `${head}:${v.steamid}:${v.appid}:${v.source}:${v.text}`
}

export function pickShareSig(secret: string, v: PickShareFields): string {
  return createHmac('sha256', secret).update(sigMessage(v)).digest('base64url').slice(0, SIG_LEN)
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
 *
 * lang — на английском герое: подпись покрывает язык, и клиент возвращает
 * его в /api/pick вместе с текстом. У русского поля нет — ответ тот же, что
 * до английской версии, и /api/pick без lang проверяет русскую подпись.
 */
export function shareView(
  secret: string,
  v: PickShareFields,
): { share?: { text: string; sig: string; lang?: 'en' } } {
  // Пустой текст (всё объяснение было про цену, см. shareText) — кнопки нет
  if (!v.text.trim()) return {}
  const sig = pickShareSig(secret, v)
  return { share: v.lang === 'en' ? { text: v.text, sig, lang: 'en' } : { text: v.text, sig } }
}
