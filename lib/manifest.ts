import type { MetadataRoute } from 'next'
import { htmlLang, lp, tr, type Locale } from './i18n'
import { siteDescription, siteTitle } from './site'
import { THEME_COLOR } from './themecolor'

/**
 * Манифест — ради «добавить на домашний экран», а не ради полноценного PWA.
 *
 * Сервис-воркера здесь нет и не планируется: офлайн-режим для продукта, вся
 * ценность которого в свежих данных Steam, показывал бы вчерашнюю библиотеку
 * и вчерашний онлайн. А вот запуск с домашнего экрана без адресной строки —
 * ровно тот сценарий, ради которого ссылку и сохраняют.
 *
 * display: 'standalone' плюс viewportFit: 'cover' в layout: только вдвоём они
 * дают нижнюю панель, не уезжающую под домашнюю полоску iOS.
 *
 * Имя и описание — те же строки, что у корневого layout (lib/site.ts). Здесь
 * одна копия уже пережила смену позиционирования и обещала «из бэклога,
 * заброшенного или нового» — в окне установки, то есть тому, кто уже решил
 * остаться.
 *
 * ДВА ЯЗЫКА — ДВА МАНИФЕСТА. Русский — /manifest.webmanifest (app/manifest.ts),
 * английский — /manifest.en.webmanifest (app/manifest.en.webmanifest), и
 * страница ссылается на манифест своего языка (metadata.manifest корневого
 * layout). Один манифест на оба языка ставил бы с /en приложение с русским
 * именем, описанием и ярлыками в русский сайт. Английский — не под /en: туда
 * правило beforeFiles переписывает только разделы, а русскому адресу
 * /manifest.webmanifest пришлось бы стать разделом, и правило отнимало бы
 * его у файла (lib/i18nroutes.ts).
 */
export function manifestFor(locale: Locale): MetadataRoute.Manifest {
  return {
    /*
     * id — личность установленного приложения. Без него ею служит start_url,
     * и первая же его смена (например, на /quiz вместо кино-лендинга) сделала
     * бы у всех установивших «другое» приложение рядом со старым.
     *
     * У английского свой id: с общим браузер считал бы обе версии одним
     * приложением и переписывал бы его имя и язык тем манифестом, который
     * видел последним.
     */
    id: lp(locale, '/'),
    name: siteTitle(locale),
    short_name: 'imbored',
    description: siteDescription(locale),
    start_url: lp(locale, '/'),
    display: 'standalone',
    // Совпадает с --bg тёмной темы: она базовая, и экран запуска не должен
    // моргать белым перед тем, как приложение отрисуется.
    background_color: '#050505',
    // Одна константа с meta theme-color в разметке (lib/themecolor): они уже
    // расходились — манифест тёмный, meta по теме ОС
    theme_color: THEME_COLOR,
    lang: htmlLang(locale),
    categories: ['games', 'entertainment'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        // Именно /apple-icon, без расширения: так называется маршрут, который
        // Next заводит для app/apple-icon.tsx. С .png будет 404.
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
      {
        /*
         * Без этой строки Android рисует под иконку СВОЮ подложку и
         * вписывает картинку внутрь: знак с собственным тёмным квадратом
         * оказывается в белом круге и уменьшенным вдвое. То есть единственный
         * сценарий, ради которого этот файл существует, выглядел хуже всего.
         */
        src: '/maskable-icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    /*
     * Долгое нажатие на иконку — сразу в три главных двери, мимо лендинга.
     * Имена те же, что в навигации (HeaderNav и MobileNav), чтобы человек
     * узнавал их, а не переводил. Адреса — на языке манифеста.
     */
    shortcuts: [
      {
        name: tr(locale, { ru: 'Подобрать игру', en: 'Find a game' }),
        short_name: tr(locale, { ru: 'Подбор', en: 'Pick' }),
        description: tr(locale, {
          ru: 'Три вопроса — и одна игра из твоей библиотеки',
          en: 'Three questions — and one game from your library',
        }),
        url: lp(locale, '/quiz'),
      },
      {
        name: tr(locale, { ru: 'Игра дня', en: 'Game of the day' }),
        // Короткое имя — только английскому: русское и так равно подписи
        // нижней панели, а английская панель зовёт её Daily
        ...(locale === 'en' ? { short_name: 'Daily' } : {}),
        description: tr(locale, {
          ru: 'Одна игра на сегодня, та же самая до завтра',
          en: 'One game for today — the same one until tomorrow',
        }),
        url: lp(locale, '/daily'),
      },
      {
        name: tr(locale, { ru: 'Пати', en: 'Party' }),
        description: tr(locale, {
          ru: 'Выбрать игру на вечер вместе с друзьями',
          en: 'Pick tonight’s game together with friends',
        }),
        url: lp(locale, '/rooms'),
      },
    ],
    /*
     * Без снимков Chrome показывает упрощённое окно установки — голую иконку
     * с именем. Снимки — первый экран главной в двух раскладках, как её видит
     * человек до входа: телефон 390×844 и десктоп 1280×800, оба с плотностью
     * пикселей больше единицы. Лежат в public/screenshots; пересняты с
     * локальной сборки, при смене первого экрана их надо переснять. У
     * английского манифеста — свои снимки английской главной (*.en.jpg):
     * русские показали бы в окне установки русский сайт.
     */
    screenshots: [
      {
        src: locale === 'en' ? '/screenshots/narrow.en.jpg' : '/screenshots/narrow.jpg',
        sizes: '780x1688',
        type: 'image/jpeg',
        form_factor: 'narrow',
        label: tr(locale, {
          ru: 'Главная imbored на телефоне: скажи, сколько у тебя времени и сил, — дадим одну игру',
          en: 'The imbored home page on a phone: tell us how much time and energy you have, and we’ll give you one game',
        }),
      },
      {
        src: locale === 'en' ? '/screenshots/wide.en.jpg' : '/screenshots/wide.jpg',
        sizes: '1920x1200',
        type: 'image/jpeg',
        form_factor: 'wide',
        label: tr(locale, {
          ru: 'Главная imbored на компьютере: вход через Steam и демо без него',
          en: 'The imbored home page on a computer: sign in with Steam, or try the demo without it',
        }),
      },
    ],
  }
}

/** Адрес манифеста страницы — для metadata.manifest корневого layout */
export function manifestHref(locale: Locale): string {
  return locale === 'en' ? '/manifest.en.webmanifest' : '/manifest.webmanifest'
}
