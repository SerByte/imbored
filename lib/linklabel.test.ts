import { describe, expect, test } from 'vitest'
import { linkLabel } from './linklabel'

/** Все входные строки — настоящие подписи ссылок из патчнотов Steam. */
describe('подпись ссылки в чужом тексте', () => {
  test('голый адрес показывается хостом', () => {
    expect(linkLabel('https://questions.satisfactorygame.com/', 'https://questions.satisfactorygame.com/')).toBe(
      'questions.satisfactorygame.com',
    )
    expect(linkLabel('https://fishlabs.de/', 'https://fishlabs.de/')).toBe('fishlabs.de')
    expect(linkLabel('https://www.youtube.com/watch?v=aoHCYhlYjlc', 'https://www.youtube.com/watch?v=aoHCYhlYjlc')).toBe('youtube.com/watch')
  })

  test('длинный путь обрезается, а не тянется через весь экран', () => {
    const raw =
      'https://store.steampowered.com/app/4329470/Vampire_Crawlers_The_Turbo_Wildcard_from_Vampire_Survivors_Demo?snr=1_5_9__405'
    const out = linkLabel(raw, raw)
    expect(out.startsWith('store.steampowered.com/app/')).toBe(true)
    // хост + 24 символа пути + многоточие
    expect(out.length).toBeLessThan(50)
    expect(out.endsWith('…')).toBe(true)
  })

  /**
   * Обёртку Valve надо разворачивать, иначе на экране написан один сайт, а
   * откроется другой.
   */
  test('линкфильтр Steam показывает настоящий адрес', () => {
    const wrapped = 'https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fforums.factorio.com%2F131012'
    expect(linkLabel(wrapped, wrapped)).toBe('forums.factorio.com/131012')
  })

  test('битый адрес не роняет и остаётся как есть', () => {
    expect(linkLabel('https://', 'https://')).toBe('https://')
    expect(linkLabel('http://[', 'http://[')).toBe('http://[')
  })

  /**
   * Короткие подписи не трогаем сознательно: такая ссылка стоит внутри
   * предложения, и предложение и есть её контекст.
   */
  test('обычные подписи не меняются', () => {
    expect(linkLabel('more', 'https://example.com')).toBe('more')
    expect(linkLabel('Discord', 'https://discord.gg/x')).toBe('Discord')
    expect(linkLabel('список изменений', 'https://example.com')).toBe('список изменений')
    expect(linkLabel('', 'https://example.com')).toBe('')
  })

  test('подпись длиной в абзац обрезается по границе слова', () => {
    const long = 'Очень длинное предложение про обновление '.repeat(6)
    const out = linkLabel(long, 'https://example.com')
    expect(out.length).toBeLessThanOrEqual(121)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/\s…$/)
  })

  test('адрес внутри осмысленной подписи не трогаем', () => {
    expect(linkLabel('читай на https://example.com', 'https://example.com')).toBe(
      'читай на https://example.com',
    )
  })
})
