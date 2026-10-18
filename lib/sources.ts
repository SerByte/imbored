import { tr, type Locale } from './i18n'
import type { CandidateSource } from './types'

/**
 * Подписи источников для карточки рекомендации.
 *
 * Отдельный модуль без серверных зависимостей, как lib/stores.ts: раньше эта
 * карта лежала копипастой в /play и /daily, и добавление источника оставило бы
 * обе страницы с пустым бейджем — молча, без ошибки типов.
 *
 * «Куплена, но не распакована» теперь стоит там, где это правда: раньше её
 * получала и игра с 110 минутами на счётчике, потому что бэклогом считалось
 * всё до двух часов.
 */
export const SOURCE_BADGE: Record<CandidateSource, string> = {
  untouched: 'Куплена, но не распакована',
  backlog: 'Открыл и закрыл',
  comeback: 'Пора вернуться',
  familiar: 'Любимое',
  // Время скрыто настройками Steam: известно только, что игра своя
  owned: 'Из твоей библиотеки',
  new: 'Новое для тебя',
}

/**
 * Короткая форма — для плиток, а не для героя.
 *
 * Подписи выше выбраны под полосу во всю ширину карточки выдачи, и там они
 * работают. В сетке «ещё варианты» на телефоне плитка шириной 163px даёт
 * подписи 134px, и замер на живой странице показал: «Куплена, но не
 * распакована» просит 148 и обрезается многоточием, «Новое для тебя» просит 82
 * и получает 66, когда рядом стоит цена. Не на пиксель — по построению: 26
 * символов в 11px в такую плитку не влезут никогда.
 *
 * Тот же Record<CandidateSource, string>, что и выше, намеренно: новый источник
 * обязан появиться в ОБЕИХ картах, иначе не соберётся. Ровно этого опасается
 * докблок модуля — там та же ошибка однажды оставила бы пустой бейдж молча.
 *
 * «Не распакована» вдобавок совпадает с фильтром библиотеки («Не распакованы»),
 * то есть одно и то же состояние наконец называется в продукте одним словом.
 */
export const SOURCE_BADGE_SHORT: Record<CandidateSource, string> = {
  untouched: 'Не распакована',
  backlog: 'Открыл и закрыл',
  comeback: 'Пора вернуться',
  familiar: 'Любимое',
  owned: 'Твоя',
  new: 'Новое',
}

/**
 * Английские подписи — по глоссарию (docs/i18n.md), под те же две ширины:
 * полная — полоса героя, короткая — плитка. «Bounced off» — одно слово на
 * источник, фильтр библиотеки и состояние плитки, как «Открыл и закрыл»;
 * «Unopened» — то же, что фильтр «Не распакованы».
 *
 * Тот же Record<CandidateSource, string> в обеих картах — новый источник
 * не соберётся без английской подписи, как и без русской.
 */
const SOURCE_BADGE_EN: Record<CandidateSource, string> = {
  untouched: 'Bought, never opened',
  backlog: 'Bounced off',
  comeback: 'Time to go back',
  familiar: 'Old favorite',
  owned: 'From your library',
  new: 'New to you',
}

const SOURCE_BADGE_SHORT_EN: Record<CandidateSource, string> = {
  untouched: 'Unopened',
  backlog: 'Bounced off',
  comeback: 'Time to go back',
  familiar: 'Favorite',
  owned: 'Yours',
  new: 'New',
}

/** Подпись источника для полосы героя на языке страницы; SOURCE_BADGE — русская карта */
export function sourceBadge(source: CandidateSource, locale: Locale = 'ru'): string {
  return tr(locale, { ru: SOURCE_BADGE, en: SOURCE_BADGE_EN })[source]
}

/** Короткая подпись для плитки на языке страницы; SOURCE_BADGE_SHORT — русская */
export function sourceBadgeShort(source: CandidateSource, locale: Locale = 'ru'): string {
  return tr(locale, { ru: SOURCE_BADGE_SHORT, en: SOURCE_BADGE_SHORT_EN })[source]
}

/**
 * Кому под героем ссылка «Ещё не установлена? Поставь на загрузку заранее»
 * (steam://install): своей игре, которая скорее всего не установлена, —
 * нетронутой и заброшенной. /play и /daily решали это каждая своим условием,
 * и при скрытом в Steam времени (owned) ссылку теряли обе: вся своя выдача
 * тогда идёт этим источником, а большая часть любой библиотеки на диске не
 * лежит.
 */
export function suggestsInstall(source: CandidateSource): boolean {
  return source === 'untouched' || source === 'comeback' || source === 'owned'
}
