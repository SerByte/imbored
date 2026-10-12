import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionHint } from './sessionhint'

/**
 * Строка над заголовком главной (components/landing/HeroNotice) — после
 * «Удалить всё обо мне».
 *
 * Кнопка удаления уводит на главную (components/ForgetMe), а там человек —
 * уже гость. Без строки он видел бы обычный лендинг и не знал, сработало ли:
 * удаление необратимо, и «а точно удалилось?» — первый вопрос после него.
 *
 * Зажигает строку метка самого удаления (lib/forgotnotice), а не адрес. Здесь
 * рендер серверный, и useSyncExternalStore берёт серверные снимки — их и
 * подменяем: метку как забранную, подсказку о входе как прочитанную.
 */

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  forgot: false,
  hint: null as SessionHint | null,
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => state.params }))
vi.mock('@/lib/forgotnotice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./forgotnotice')>()),
  forgotServer: () => state.forgot,
}))
vi.mock('@/lib/sessionhint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sessionhint')>()),
  getServerSessionHint: () => state.hint,
}))

const { HeroNotice } = await import('@/components/landing/HeroNotice')

const render = (query = '') => {
  state.params = new URLSearchParams(query)
  return renderToStaticMarkup(createElement(HeroNotice))
}

beforeEach(() => {
  state.params = new URLSearchParams()
  state.forgot = false
  state.hint = null
})

describe('HeroNotice после удаления', () => {
  test('метка удаления — говорит, что всё удалено и входы погашены', () => {
    state.forgot = true
    const html = render()
    expect(html).toContain('всё, что imbored о тебе хранил, удалено')
    expect(html).toContain('входы на всех устройствах погашены')
  })

  /*
   * «Всё удалено» без оговорки спорило с отметкой удаления: SteamID и время
   * живут ещё год и месяц (forget_marks). Строка говорит о ней теми же
   * словами, что вопрос «Удалить всё?» и /privacy (lib/forget.test.ts).
   */
  test('и честно — про отметку удаления: что осталось и на сколько', () => {
    state.forgot = true
    const html = render()
    expect(html).toContain('Осталась только отметка — SteamID и время удаления')
    expect(html).toContain('Через год и месяц она сотрётся сама')
  })

  /*
   * Строка — цель фокуса после удаления (lib/focushandoff.test.ts): иначе
   * скринридер слышал только заголовок вкладки, а не «удалено». Не живая
   * область: цель фокуса ею быть не может (lib/liveregion.test.ts).
   */
  test('строка принимает фокус программно и не объявляет себя живой областью', () => {
    state.forgot = true
    const html = render()
    expect(html).toContain('tabindex="-1"')
    expect(html).not.toMatch(/\srole=|aria-live/)
  })

  test('без метки — прежнее поведение: гостю, пришедшему сам, пусто', () => {
    expect(render()).toBe('')
  })

  /*
   * Адрес /?forgot=1 оставался в истории и в подсказках адресной строки, и
   * его можно было прислать: строка звучала на каждой перезагрузке, через
   * месяц и у того, кто ничего не удалял.
   */
  test('адрес строку больше не зажигает', () => {
    expect(render('forgot=1')).toBe('')
  })

  test('вошедшему — никогда: «входы погашены» рядом с «С возвращением» врёт', () => {
    state.forgot = true
    state.hint = { authed: true, personaName: 'Гордон' }
    expect(render()).toBe('')
    // а приглашение в пати по-прежнему звучит — место за ним
    expect(render('join=ABC234')).toContain('пати ABC234')
  })

  test('метка удаления важнее приглашения: строка о пати не перебивает «удалено»', () => {
    state.forgot = true
    expect(render('join=ABC234')).not.toContain('пати')
  })
})
