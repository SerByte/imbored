import { clip, DESCRIPTION_MAX } from './clip'
import { withRef } from './track'
import { CANDIDATE_SOURCES, type CandidateSource } from './types'

/**
 * Выбор, которым поделились: /pick/<id> — «imbored выбрал мне на вечер».
 *
 * Модуль чистый и годится клиенту: разбор тела запроса, очистка текста,
 * адрес и тексты для страницы и карточки. Подпись — в lib/pickshare
 * (node:crypto), база — в lib/db.
 */

/** Непрозрачный id — lib/pickshare newPickId */
export const SHARED_PICK_ID_RE = /^[a-hjkmnp-z2-9]{12}$/

/** Причина от модели — до трёхсот знаков, шаблона — короче; с запасом */
export const SHARED_REASON_MAX = 400

/** Ссылку на выбор кидают на вечер, а не навсегда */
export const SHARED_PICK_TTL_SEC = 30 * 86_400

/**
 * Повторное «Отправить» возвращает прежнюю ссылку только в пределах суток:
 * это двойное нажатие и пересылка в тот же вечер. Позже — новая ссылка со
 * своим полным сроком (см. findSharedPick).
 */
export const SHARED_PICK_REUSE_SEC = 86_400

export const PICK_KINDS = ['play', 'daily'] as const
export type PickKind = (typeof PICK_KINDS)[number]

/**
 * Предложение говорит о деньгах: сумма, скидка, «бесплатная», «цена».
 *
 * Суммы у нас всегда в долларах (lib/discount formatPrice), но модель пишет
 * своими словами, поэтому ловятся и рубли, и знак процента со скидочным
 * минусом. Проценты отзывов («92% положительных») не ловятся: у них нет
 * минуса перед числом.
 */
const PRICE_TALK =
  /[$€£]\s?\d|\d[\d\s\u00a0.,]*\s?(?:₽|руб)|[−–-]\s?\d{1,2}\s?%|скидк|распродаж|бесплатн|дешевле|(?:^|[^а-яё])цен(?:а|у|е|ы|ой)(?:[^а-яё]|$)/i

/**
 * Текст причины для ссылки — без денег.
 *
 * Страница по ссылке живёт месяц, а цена и скидка — дни: застывшие в тексте,
 * они стали бы враньём под чужим именем. Сначала отрезается ценовой хвост
 * шаблона (reasonPrice) — только если причина им правда кончается. Потом
 * выпадают предложения, где о деньгах говорит сама модель: промпт просит её
 * назвать цену у игры из магазина прямо в тексте (lib/llm claudePicks).
 *
 * Пустая строка — делиться нечем: всё объяснение было про цену.
 */
export function shareText(reason: string, priceTail: string): string {
  const base = priceTail && reason.endsWith(priceTail) ? reason.slice(0, -priceTail.length) : reason
  return base
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => !PRICE_TALK.test(sentence))
    .join(' ')
    .trim()
}

/** Тело POST /api/pick — проверкой формы, а не приведением типом */
export function parseSharePickBody(
  raw: unknown,
): { appid: number; source: CandidateSource; kind: PickKind; text: string; sig: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const { appid, source, kind, text, sig } = raw as Record<string, unknown>
  // appid отрицательный — игра чужого магазина, это законно
  if (typeof appid !== 'number' || !Number.isSafeInteger(appid) || appid === 0) return null
  if (typeof source !== 'string' || !(CANDIDATE_SOURCES as readonly string[]).includes(source)) return null
  if (typeof kind !== 'string' || !(PICK_KINDS as readonly string[]).includes(kind)) return null
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) return null
  if (typeof sig !== 'string') return null
  return { appid, source: source as CandidateSource, kind: kind as PickKind, text, sig }
}

/**
 * Текст причины для публичной страницы: без управляющих знаков и
 * двунаправленных меток (ими переворачивают строку на экране), без
 * невидимых пробелов, одной строкой и не длиннее SHARED_REASON_MAX. Подпись
 * сверяется по сырому тексту, хранится — очищенный.
 */
export function cleanReason(text: string): string {
  const flat = text
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clip(flat, SHARED_REASON_MAX) ?? flat.slice(0, SHARED_REASON_MAX)
}

/**
 * В кавычки-«ёлочки». Причина сама начинается с названия в «ёлочках», и
 * обёрнутая как есть давала «««How to Fish» в…». Внутренние кавычки —
 * „лапки“, как принято в русском наборе.
 */
export function quoted(text: string): string {
  return `«${text.replace(/«/g, '„').replace(/»/g, '“')}»`
}

/** Адрес выбора с меткой воронки — как roomShareUrl у пати */
export function pickShareUrl(origin: string, id: string): string {
  return withRef(`${origin}/pick/${id}`, 'pick')
}

export type SharedPickView = { name: string; reason: string; kind: PickKind }

/**
 * Тексты страницы и карточки в чате — одни на обе, как inviteCopy у пати:
 * заголовок вкладки и превью обязаны говорить одно. null — выбора нет
 * (истёк, удалён, опечатка): карточка остаётся приглашением.
 */
export function pickCopy(p: SharedPickView | null): {
  title: string
  description: string
  eyebrow: string
  foot: string
} {
  const foot = 'А тебе? Подберёт одну игру за минуту — imbored.cc'
  if (!p) {
    return {
      title: 'Выбор на вечер — imbored',
      description: 'imbored выбирает одну игру на вечер из твоей библиотеки Steam — и объясняет почему.',
      eyebrow: 'IMBORED · ВЫБОР НА ВЕЧЕР',
      foot,
    }
  }
  return {
    title: p.kind === 'daily' ? `${quoted(p.name)} — моя игра дня` : `${quoted(p.name)} — imbored выбрал мне на вечер`,
    description: clip(p.reason, DESCRIPTION_MAX) ?? p.reason.slice(0, DESCRIPTION_MAX),
    eyebrow: p.kind === 'daily' ? 'МОЯ ИГРА ДНЯ' : 'IMBORED ВЫБРАЛ МНЕ НА ВЕЧЕР',
    foot,
  }
}
