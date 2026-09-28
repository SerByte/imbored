import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
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
    // На эту фразу ссылается components/TagChips.tsx как на обещание продукта
    expect(out).toContain('Рекомендация — это доверие')
  })
})
