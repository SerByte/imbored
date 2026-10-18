import { createElement, type ComponentProps, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prerender } from 'react-dom/static'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LocaleProvider } from '@/components/LocaleProvider'
import SupportPage from './page'

/**
 * /support обещает только то, что есть.
 *
 * Страница просит доверия и дважды его подводила. Блок imbored+ продавал
 * перки, которых в коде нет: «Большие пати» снимали лимит, которого не
 * существует, «Безлимит ИИ-объяснений» — лимит, который не личный, а «Итоги
 * года раньше всех» — то, что и так открыто всем. А без адреса доната над
 * строкой «реквизитов нет» стоял заголовок «Поддержать рублём».
 *
 * Страница рендерится целиком: у неё нет ни базы, ни клиентских островков,
 * а адрес доната она читает при рендере — значит, оба состояния можно
 * получить подменой переменной окружения.
 */

function html(donate: string | undefined): string {
  vi.stubEnv('NEXT_PUBLIC_DONATE_URL', donate)
  return renderToStaticMarkup(SupportPage())
}

/** Все href страницы — чтобы видеть, куда она вообще может увести */
const hrefs = (out: string) => [...out.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1])

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('страница поддержки', () => {
  test.each([
    ['не задан', undefined],
    ['пустой', ''],
    ['без схемы', 'boosty.to/imbored'],
    ['не http', 'javascript:alert(1)'],
  ])('адрес доната %s — ни «рублём», ни кнопки, а честный ответ, как помочь', (_, donate) => {
    const out = html(donate)
    expect(out).not.toContain('Поддержать рублём')
    expect(out).not.toContain('Поддержать проект')
    expect(out).not.toContain('target="_blank"')
    expect(out).toContain('Как поддержать')
    expect(out).toContain('реквизитов нет')
    // Каждая ссылка ведёт на свою страницу или в почту: ни пустого href, ни
    // адреса без схемы, который стал бы 404 собственного сайта
    const links = hrefs(out)
    expect(links).toContain('mailto:hello@imbored.cc')
    for (const href of links) expect(href, href).toMatch(/^(\/[a-z]|mailto:)/)
  })

  test('с адресом — «Поддержать рублём» и кнопка ровно туда, в новой вкладке без referrer', () => {
    const out = html('https://boosty.to/imbored')
    expect(out).toContain('Поддержать рублём')
    expect(out).not.toContain('Как поддержать')
    const button = out.match(/<a\b[^>]*>Поддержать проект<\/a>/)?.[0]
    expect(button, 'кнопки доната нет').toBeDefined()
    expect(button).toContain('href="https://boosty.to/imbored"')
    expect(button).toContain('target="_blank"')
    expect(button).toContain('rel="noreferrer"')
  })

  test('адрес с пробелами по краям из панели Vercel не ломает кнопку', () => {
    const out = html('  https://boosty.to/imbored\n')
    expect(out).toContain('href="https://boosty.to/imbored"')
  })

  /*
   * Проверка по словам, а не по устройству: платный блок узнаётся по своим
   * словам — «imbored+», «когда-нибудь», названия прежних перков. Вернуть
   * платное можно, но вместе с кодом, который оно открывает, тестом на этот
   * код и правкой этого сторожа.
   */
  test.each([
    ['без адреса доната', undefined],
    ['с адресом доната', 'https://boosty.to/imbored'],
  ])('%s — ни платного тарифа, ни перков, итоги года названы бесплатными', (_, donate) => {
    const out = html(donate)
    expect(out).not.toMatch(/imbored<span[^>]*>\+<\/span>/)
    for (const promise of ['когда-нибудь', 'Безлимит', 'раньше всех', 'эксклюзив', 'вайб-пресеты']) {
      expect(out, promise).not.toContain(promise)
    }
    expect(out).toContain('портрет и итоги года — бесплатны навсегда')
    // На эту фразу ссылается components/TagChips.tsx как на обещание продукта.
    // Сверка по словам, а не по пробелам: перед тире стоит неразрывный (&nbsp;),
    // чтобы строка на телефоне не начиналась с тире, — как в сцене Money
    expect(out.replace(/\u00a0/g, ' ')).toContain('Рекомендация — это доверие')
  })
})

/*
 * /en/support — та же страница по-английски: язык приходит в params, и
 * страница читает его use(), поэтому рендер ждёт данных (prerender), а не
 * отдаёт строку сразу. Обещания те же, что у русской, и проверяются теми же
 * словами: ни «рублём» без адреса, ни платных перков, принцип — фразой
 * глоссария, общей со сценой денег на главной.
 */
describe('страница поддержки по-английски', () => {
  async function htmlEn(donate: string | undefined): Promise<string> {
    vi.stubEnv('NEXT_PUBLIC_DONATE_URL', donate)
    const params = Promise.resolve({ lang: 'en' })
    // язык ссылок (components/Link) — из провайдера, как под корневым layout
    // страница ждёт params необязательным (её зовут и без них), createElement — обязательным
    const page = createElement(SupportPage as FunctionComponent<{ params: typeof params }>, { params })
    const { prelude } = await prerender(createElement(LocaleProvider, { locale: 'en' } as ComponentProps<typeof LocaleProvider>, page))
    return new Response(prelude).text()
  }

  test('без адреса доната — честный ответ, как помочь, и ни слова по-русски', async () => {
    const out = await htmlEn(undefined)
    expect(out).toContain('How to support us')
    expect(out).not.toContain('Support with a donation')
    expect(out).not.toContain('target="_blank"')
    expect(out).toContain('mailto:hello@imbored.cc')
    expect(out).toContain('href="/en/quiz"')
    expect(out.replace(/\u00a0/g, ' ')).toContain(
      'we don’t sell spots in our picks. A recommendation is trust, and trust isn’t for sale.',
    )
    expect(out).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('с адресом — «Support with a donation» и кнопка ровно туда', async () => {
    const out = await htmlEn('https://boosty.to/imbored')
    expect(out).toContain('Support with a donation')
    expect(out).not.toContain('How to support us')
    const button = out.match(/<a\b[^>]*>Support the project<\/a>/)?.[0]
    expect(button, 'кнопки доната нет').toBeDefined()
    expect(button).toContain('href="https://boosty.to/imbored"')
    expect(out).not.toMatch(/[А-Яа-яЁё]/)
  })
})
