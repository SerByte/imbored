import { clip, DESCRIPTION_MAX } from './clip'
import { PATCH_SINCE_LEAD } from './comeback'
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
 * Суммы шаблон пишет по-русски, знаком после числа и в валюте региона цен
 * (formatPrice в lib/steamregion): «1 999 ₽», «59,99 $», «4 499 ₸». Модель
 * пишет своими словами и знак ставит где придётся, поэтому ловятся обе
 * стороны — «$24.99» и «24,99 $», рубли и словом «руб», — и знак процента со
 * скидочным минусом. Проценты отзывов («92% положительных») не ловятся: у них
 * нет минуса перед числом.
 */
const PRICE_TALK =
  /[$€£]\s?\d|\d[\d\s\u00a0.,]*\s?(?:[$€£₸₴₽]|руб)|[−–-]\s?\d{1,2}\s?%|скидк|распродаж|бесплатн|дешевле|(?:^|[^а-яё])цен(?:а|у|е|ы|ой)(?:[^а-яё]|$)/i

/**
 * Факт «с последнего захода вышло обновление» — где бы в предложении он ни
 * стоял и в каком бы регистре ни был.
 *
 * Шаблон начинает им предложение (PATCH_SINCE_LEAD), но модель получает его
 * в промпте серединой строки («…; с его последнего захода вышло крупное
 * обновление: …», lib/llm claudePicks) и вольна вписать его внутрь своей
 * фразы: «Вернись в «X»: с твоего последнего захода вышло…». Проверка по
 * startsWith такое пропустила бы на публичную /pick. Корень — «последнего
 * захода (запуска) вышло/вышел/вышла/вышли», без местоимения: «твоего»,
 * «его» и «с» модель меняет, а смысл выдаёт именно эта связка.
 */
const PATCH_SINCE_TALK = /последнего\s+(?:захода|запуска)\s+вы(?:шл|ш[её]л)/i

/**
 * Текст причины для ссылки — без денег и без «с твоего последнего захода».
 *
 * Страница по ссылке живёт месяц, а цена и скидка — дни: застывшие в тексте,
 * они стали бы враньём под чужим именем. Сначала отрезается ценовой хвост
 * шаблона (reasonPrice) — только если причина им правда кончается. Потом
 * выпадают предложения, где о деньгах говорит сама модель: промпт просит её
 * назвать цену у игры из магазина прямо в тексте (lib/llm claudePicks).
 *
 * Факт о патче (PATCH_SINCE_LEAD, lib/comeback.ts) выпадает тоже. На
 * публичной /pick и в её превью «С твоего последнего захода вышло…» читает
 * получатель — и понимает как про себя, а сам факт выдаёт дату последнего
 * запуска отправителя (её и на /play видит только writer-сессия). Ловится
 * не только начало предложения из шаблона: модель (claudePicks) получает
 * факт строкой промпта «с его последнего захода вышло…» и пересказывает его
 * где угодно в предложении и в любом регистре — см. PATCH_SINCE_TALK.
 * patch — пересказ этого патча, если он известен (patchOf): пересказ бывает
 * в несколько предложений, и хвост его, идущий следом за фразой с фактом,
 * уходит вместе с ней. Без patch уходит только само предложение с фактом.
 *
 * Пустая строка — делиться нечем: всё объяснение было про цену.
 */
export function shareText(reason: string, priceTail: string, patch?: string | null): string {
  const base = priceTail && reason.endsWith(priceTail) ? reason.slice(0, -priceTail.length) : reason
  const told = patch ? patch.toLowerCase() : ''
  let inFact = false
  return base
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => {
      if (sentence.startsWith(PATCH_SINCE_LEAD) || PATCH_SINCE_TALK.test(sentence)) {
        inFact = true
        return false
      }
      // Хвост пересказа — дословный кусок patch (шаблон режет его trimTldr
      // по границе предложения или слова с «…»), знаки конца не в счёт
      if (inFact) {
        const core = sentence.replace(/[.!?…]+$/, '').trim().toLowerCase()
        if (core && told.includes(core)) return false
        inFact = false
      }
      return !PRICE_TALK.test(sentence)
    })
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
 *
 * Описание (оно же og:description и twitter:description) — причина В
 * КАВЫЧКАХ, как цитата на самой странице и на карточке в чате. Причина
 * обращена к тому, кто делился («У тебя в «Terraria» уже 130 ч… вернись и
 * проверь»), и голой строкой под заголовком «imbored выбрал мне на вечер»
 * превью читалось как сказанное получателю: будто это он наиграл сто
 * тридцать часов в игру, которой у него, может, и нет. Кавычки делают её
 * тем, что она есть, — словами imbored отправителю. Место под них берётся
 * из того же потолка сниппета, а не сверх него.
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
    // −2 — на сами «»: с ними описание не длиннее DESCRIPTION_MAX
    description: quoted(clip(p.reason, DESCRIPTION_MAX - 2) ?? p.reason.slice(0, DESCRIPTION_MAX - 2)),
    eyebrow: p.kind === 'daily' ? 'МОЯ ИГРА ДНЯ' : 'IMBORED ВЫБРАЛ МНЕ НА ВЕЧЕР',
    foot,
  }
}
