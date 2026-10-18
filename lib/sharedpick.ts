import { clip, DESCRIPTION_MAX } from './clip'
import { PATCH_SINCE_LEADS } from './comeback'
import { lp, type Locale } from './i18n'
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
 * То же в английской причине. Суммы ловит PRICE_TALK выше — знак валюты он
 * узнаёт с обеих сторон числа. Здесь — слова: скидка по-английски пишется
 * без минуса («30% off»), а «free», «sale», «price», «costs», «cheaper» —
 * то, чем модель называет деньги. «free» шире денег («free roam»), и такое
 * предложение тоже выпадет: лишний вырезанный кусок дешевле застывшей цены
 * под чужим именем. Проценты отзывов («92% of reviews») не ловятся — после
 * них нет «off».
 */
const PRICE_TALK_EN =
  /\b\d{1,2}\s?%\s?off\b|\b(?:free|sale|discount(?:ed|s)?|cheap(?:er|est)?|pric(?:e|es|ed|ey)|costs?|bargain)\b/i

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
 * Тот же факт в английской причине. Английский промпт даёт модели строку
 * «since they last played, a major update came out», и пересказывает она его
 * как угодно: «since you last played», «since your last session», «a lot
 * changed since you played». Связка здесь — «since» + местоимение + «last»
 * или глагол захода: она одна выдаёт дату чужого последнего запуска, даже без
 * слова «update», поэтому условия «вышло» у неё нет. «Since launch» и «your
 * last session ended…» без «since» — не факт и остаются.
 */
const PATCH_SINCE_TALK_EN =
  /\bsince\s+(?:you|they|your|their)\s+(?:last\b|(?:last\s+)?(?:played|launched|opened|left|quit)\b)/i

/** Вводные факта на обоих языках: причина в ссылке бывает на любом */
const PATCH_SINCE_LEAD_LIST: readonly string[] = Object.values(PATCH_SINCE_LEADS)

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
 * Языка у функции нет: правила обоих языков применяются к любой причине
 * разом (PATCH_SINCE_LEADS, PRICE_TALK_EN, PATCH_SINCE_TALK_EN). Так роутам
 * не нужно ничего знать о языке причины, а английский текст на публичной
 * /pick не уносит ни цены, ни чужого последнего запуска — это вопрос
 * приватности, а не перевода.
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
      if (
        PATCH_SINCE_LEAD_LIST.some((lead) => sentence.startsWith(lead)) ||
        PATCH_SINCE_TALK.test(sentence) ||
        PATCH_SINCE_TALK_EN.test(sentence)
      ) {
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
      return !PRICE_TALK.test(sentence) && !PRICE_TALK_EN.test(sentence)
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
 *
 * По-английски — “…”, а внутренние — одинарные ‘…’: английская причина
 * начинается с названия в “…” (шаблоны lib/llm.ts), и обёрнутая как есть дала
 * бы ““Hades” isn't…”.
 */
export function quoted(text: string, locale: Locale = 'ru'): string {
  if (locale === 'en') return `“${text.replace(/“/g, '‘').replace(/”/g, '’')}”`
  return `«${text.replace(/«/g, '„').replace(/»/g, '“')}»`
}

/**
 * Адрес выбора с меткой воронки — как roomShareUrl у пати. На 'en' — /en/pick/…:
 * получатель английской ссылки открывает английскую страницу, а не русскую.
 */
export function pickShareUrl(origin: string, id: string, locale: Locale = 'ru'): string {
  return withRef(`${origin}${lp(locale, `/pick/${id}`)}`, 'pick')
}

export type SharedPickView = { name: string; reason: string; kind: PickKind }

/**
 * Тексты страницы и карточки в чате — одни на обе, как inviteCopy у пати:
 * заголовок вкладки и превью обязаны говорить одно. null — выбора нет
 * (истёк, удалён, опечатка): карточка остаётся приглашением.
 */
export function pickCopy(
  p: SharedPickView | null,
  locale: Locale = 'ru',
): {
  title: string
  description: string
  eyebrow: string
  foot: string
} {
  const copy = PICK_COPY[locale]
  if (!p) {
    return { title: copy.title, description: copy.description, eyebrow: copy.eyebrow, foot: copy.foot }
  }
  const name = quoted(p.name, locale)
  return {
    title: p.kind === 'daily' ? copy.dailyTitle(name) : copy.playTitle(name),
    description: clip(p.reason, DESCRIPTION_MAX) ?? p.reason.slice(0, DESCRIPTION_MAX),
    eyebrow: p.kind === 'daily' ? copy.dailyEyebrow : copy.playEyebrow,
    foot: copy.foot,
  }
}

/**
 * Тексты pickCopy по языкам — по глоссарию: «Выбор на вечер» — Tonight's pick,
 * «Моя игра дня» — My game of the day, «imbored выбрал мне на вечер» —
 * imbored picked my game for tonight. Описание выбора — сама причина: она уже
 * на языке ссылки, переводить её здесь нечего.
 */
const PICK_COPY = {
  ru: {
    foot: 'А тебе? Подберёт одну игру за минуту — imbored.cc',
    title: 'Выбор на вечер — imbored',
    description: 'imbored выбирает одну игру на вечер из твоей библиотеки Steam — и объясняет почему.',
    eyebrow: 'IMBORED · ВЫБОР НА ВЕЧЕР',
    dailyTitle: (name: string) => `${name} — моя игра дня`,
    playTitle: (name: string) => `${name} — imbored выбрал мне на вечер`,
    dailyEyebrow: 'МОЯ ИГРА ДНЯ',
    playEyebrow: 'IMBORED ВЫБРАЛ МНЕ НА ВЕЧЕР',
  },
  en: {
    foot: 'Your turn? One game, picked in a minute — imbored.cc',
    title: "Tonight's pick — imbored",
    description: 'imbored picks one game for tonight from your Steam library — and tells you why.',
    eyebrow: "IMBORED · TONIGHT'S PICK",
    dailyTitle: (name: string) => `${name} — my game of the day`,
    playTitle: (name: string) => `${name} — imbored picked my game for tonight`,
    dailyEyebrow: 'MY GAME OF THE DAY',
    playEyebrow: 'IMBORED PICKED MY GAME FOR TONIGHT',
  },
} satisfies Record<
  Locale,
  {
    foot: string
    title: string
    description: string
    eyebrow: string
    dailyTitle: (name: string) => string
    playTitle: (name: string) => string
    dailyEyebrow: string
    playEyebrow: string
  }
>
