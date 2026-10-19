/**
 * На каком языке написан кусок чужого текста.
 *
 * Страница объявлена lang="ru", и скринридер читает всё её содержимое русским
 * голосом. Для нашего текста это верно, для чужого — нет: описание игры из
 * магазина и патчноуты издателей почти всегда английские, а латиницу русский
 * голос произносит по-русски или по буквам. WCAG 3.1.2 (Language of Parts, AA)
 * требует пометить такой кусок своим lang.
 *
 * Отдельным модулем, а не в lib/gamepage, где правило родилось: gamepage тянет
 * базу, errlog и серверные модули, а признак нужен и клиентским строкам ленты
 * патчей (PatchRow, GameNews). Из зависимостей — только lib/patchtitle, такой
 * же чистый и клиентобезопасный, и createElement из react — для
 * withForeignRuns; gamepage только реэкспортирует.
 *
 * Это не hasCyrillic из lib/cyrillic («есть ли что беречь» — хватает одной
 * буквы) и не detectLang из lib/news («есть ли по-русски хоть что-то для
 * пересказа» — хватает доли в 15 %). Здесь вопрос «каким голосом читать», и
 * отвечает на него большинство букв.
 */

import { createElement, type ReactNode } from 'react'
import type { Locale } from './i18n'
import { withoutGameName } from './patchtitle'

function letters(text: string): { cyr: number; lat: number } {
  return {
    cyr: text.match(/[А-Яа-яЁё]/g)?.length ?? 0,
    lat: text.match(/[A-Za-z]/g)?.length ?? 0,
  }
}

/**
 * Написан ли текст по-русски.
 *
 * short_description каталог берёт у магазина с language=english, и русский
 * есть только у тех карточек, до которых дошёл крон страниц. Выборка из 25
 * адресов карты сайта: английский хвост у 19. Кириллицы больше, чем латиницы, —
 * а не «есть хоть одна буква»: названия и аббревиатуры в русском тексте
 * латиницей («Станьте вором в VR!») его русским быть не мешают.
 */
export function isRussianText(text: string | null | undefined): boolean {
  if (!text) return false
  const { cyr, lat } = letters(text)
  return cyr > 0 && cyr >= lat
}

/**
 * Атрибут lang для куска текста: 'en', если латиница в нём перевешивает, и
 * undefined — кусок наследует lang="ru" страницы.
 *
 * Не «не русский — значит английский», и разница настоящая. Заголовок патча
 * из одних цифр («1.0.3») языка не имеет, и русский голос прочтёт цифры
 * правильно; китайский заголовок английским не станет, и lang="en" на нём
 * был бы такой же неправдой, как унаследованный ru. Помечаем только то, про
 * что знаем.
 *
 * Короткие технические заголовки вроде «Hotfix 9.0.1» WCAG из 3.1.2 и так
 * исключает, но пометка им не вредит: английский голос прочтёт их вернее.
 *
 * gameName — название игры, которое в подсчёт НЕ входит. Это имя
 * собственное (их WCAG 3.1.2 из правила исключает), а букв у него много:
 * Valve пишет локализованные заголовки как «Обновление Counter-Strike 2», и
 * 13 латинских букв названия перевешивали 10 русских — русский h1 на каждом
 * патче верхней игры каталога уходил английским голосом, то есть ровно та
 * ошибка, от которой модуль защищает, только в обратную сторону. Вызывающие
 * название знают: им же newsHeading и stripGameName срезают его на показе.
 * Если после вычета букв не осталось вовсе (заголовок — одно название),
 * считаем по целому тексту, как без него.
 */
export function textLang(
  text: string | null | undefined,
  gameName?: string | null,
): 'en' | undefined {
  if (!text) return undefined
  const { cyr, lat } = lettersWithout(text, gameName)
  return lat > cyr ? 'en' : undefined
}

/** Буквы текста без названия игры; не осталось ни одной — по целому тексту (см. textLang) */
function lettersWithout(text: string, gameName?: string | null): { cyr: number; lat: number } {
  const rest = letters(withoutGameName(text, gameName))
  return rest.cyr + rest.lat > 0 ? rest : letters(text)
}

/**
 * Атрибут lang для куска чужого текста на странице языка page.
 *
 * На русской странице — ровно textLang: помечаем латиницу. На английской
 * всё наоборот: страница объявлена lang="en", латиницу английский голос
 * читает и так, а чужим теперь стал русский текст — патчноут, который
 * издатель выпустил по-русски, или русский заголовок поста. Ему — 'ru', когда
 * кириллица в нём перевешивает, остальному — undefined, кусок наследует
 * lang="en" страницы. Правило подсчёта то же, что у textLang, и название игры
 * в него так же не входит.
 */
export function textLangOn(
  page: Locale,
  text: string | null | undefined,
  gameName?: string | null,
): 'en' | 'ru' | undefined {
  if (page !== 'en') return textLang(text, gameName)
  if (!text) return undefined
  const { cyr, lat } = lettersWithout(text, gameName)
  return cyr > lat ? 'ru' : undefined
}

/**
 * lang куска данных — ника из Steam, названия игры: 'ru', когда на /en в нём
 * перевешивает кириллица, и английский голос скринридера не читает его по
 * буквам (WCAG 3.1.2). Аудитория сайта по большей части русскоязычная, так
 * что русский ник на /en — частый случай, а не редкий.
 *
 * Только на /en. На русской странице атрибута нет, как не было: textLangOn
 * там пометил бы латинский ник как 'en', а это уже другая правка, не
 * перевод, и русская страница обязана остаться прежней до байта.
 *
 * Одно правило на совместимость (app/[lang]/compat/nick.tsx) и портрет
 * (app/[lang]/portrait/[steamid]/portrait-text.tsx): раньше у каждой была
 * своя копия.
 */
export function langOn(locale: Locale, text: string): 'ru' | undefined {
  return locale === 'en' && textLangOn(locale, text) === 'ru' ? 'ru' : undefined
}

/**
 * Текст с вкраплениями данных: на /en каждое вхождение русского ника или
 * названия игры — своим <span lang="ru">, остальное наследует lang страницы.
 *
 * Фраза остаётся одним шаблоном tr() или одной строкой модели и режется уже
 * готовой: склеивать её из кусков ради пометки значило бы собирать
 * английский порядок слов из обрывков. Искать ник в английской фразе
 * безопасно: кириллицы в шаблоне нет, и русский ник находит только сам себя.
 *
 * Нечего помечать (русская страница, латинские ники) — та же строка, одним
 * текстовым узлом, как раньше. Есть что — массив кусков без общей обёртки:
 * обёртку под флекс-родителя ставит withNicks (app/[lang]/compat/nick.tsx).
 */
export function withForeignRuns(
  locale: Locale,
  text: string,
  runs: ReadonlyArray<string | null | undefined>,
): ReactNode {
  const marked = [...new Set(runs.filter((r): r is string => !!r && langOn(locale, r) === 'ru'))]
    // Длинные первыми: «Вася Пупкин» раньше «Вася», иначе имя разрезалось бы по частям
    .sort((a, b) => b.length - a.length)
  if (!marked.length) return text
  const escaped = marked.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // С группой split оставляет найденное на нечётных местах
  return text
    .split(new RegExp(`(${escaped.join('|')})`, 'g'))
    .map((part, i) => (i % 2 ? createElement('span', { key: i, lang: 'ru' }, part) : part))
}
