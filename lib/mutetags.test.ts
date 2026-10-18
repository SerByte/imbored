import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { MuteTags } from '../components/MuteTags'
import { CONTENT_WARNING_TAGS } from './hook'
import { CARD_TAGS, cookieValue, MUTE_COOKIE, muteCookie, muteLabel, MUTES, muteSummary, parseMutes } from './mutetags'
import { topTags } from './recommend'
import type { GameMeta } from './types'

/**
 * «Не предлагать» — разбор куки и сами наборы. Суд над игрой (mutedHit) —
 * в lib/recommend.test.ts, рядом с topTags, чьим порядком он судит.
 */

const keysOf = (raw: string | null | undefined) => parseMutes(raw).map((p) => p.key)

describe('parseMutes', () => {
  test('известные ключи — в порядке наборов, без повторов', () => {
    expect(keysOf('vr.horror.vr')).toEqual(['horror', 'vr'])
  })

  test('чужое в куке — мимо поштучно, а не вся кука', () => {
    expect(keysOf('horror.<script>.__proto__.anime')).toEqual(['horror', 'anime'])
  })

  test('пусто, мусор и подозрительно длинное — пустой выбор одной и той же ссылкой', () => {
    const none = parseMutes(null)
    for (const raw of [undefined, '', '...', 'nope', 'horror.'.repeat(40)]) {
      expect(parseMutes(raw), String(raw)).toBe(none)
    }
    expect(none).toEqual([])
  })
})

describe('muteCookie', () => {
  test('выбор — на год, на весь сайт, Lax; ключи в порядке наборов', () => {
    expect(muteCookie(['vr', 'horror'], false)).toBe(
      `${MUTE_COOKIE}=horror.vr; path=/; max-age=31536000; samesite=lax`,
    )
  })

  test('https — Secure, как у сессии на деплое', () => {
    expect(muteCookie(['vr'], true)).toMatch(/; secure$/)
  })

  // Тот же путь, что у записи: иначе браузер завёл бы вторую куку рядом
  test('пустой выбор стирает куку по тому же пути', () => {
    expect(muteCookie([], false)).toBe(`${MUTE_COOKIE}=; path=/; max-age=0; samesite=lax`)
  })

  test('туда и обратно — тот же выбор', () => {
    const keys = MUTES.filter((_, i) => i % 2 === 0).map((p) => p.key)
    const header = muteCookie(keys, false).split(';')[0]
    expect(keysOf(cookieValue(`theme=dark; ${header}; other=1`, MUTE_COOKIE))).toEqual(keys)
  })
})

describe('cookieValue', () => {
  test('своя кука среди чужих — по точному имени', () => {
    expect(cookieValue('a=1; imbored_mute_x=bad; imbored_mute=horror; b=2', MUTE_COOKIE)).toBe('horror')
    expect(cookieValue('imbored_mute=; a=1', MUTE_COOKIE)).toBe('')
    expect(cookieValue('a=1', MUTE_COOKIE)).toBeNull()
    expect(cookieValue('', MUTE_COOKIE)).toBeNull()
  })
})

describe('muteSummary', () => {
  test('посреди фразы — со строчной, аббревиатуры — как есть', () => {
    expect(muteSummary(parseMutes('horror.vr.early.mmo'))).toBe('хорроры, VR, ранний доступ, MMO')
  })

  test('по-английски — то же правило: со строчной, аббревиатуры как есть', () => {
    expect(muteSummary(parseMutes('horror.vr.early.mmo'), 'en')).toBe('horror, VR, early access, MMO')
    expect(muteSummary(parseMutes('gore.pvp'), 'en')).toBe('gore and violence, competitive')
  })
})

describe('muteLabel', () => {
  test('по-английски — у каждого набора своя подпись, sentence case, без кириллицы', () => {
    const labels = MUTES.map((p) => muteLabel(p.key, 'en'))
    expect(labels).toEqual([
      'Horror',
      'VR',
      'Early access',
      'Explicit',
      'Gore and violence',
      'Anime',
      'Hardcore',
      'Competitive',
      'MMO',
    ])
    expect(new Set(labels).size).toBe(labels.length)
    for (const l of labels) expect(l).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('по умолчанию — русская подпись набора', () => {
    for (const p of MUTES) expect(muteLabel(p.key)).toBe(p.label)
  })
})

describe('наборы', () => {
  test('ключи разные и годятся в куку без кодирования', () => {
    const keys = MUTES.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-z]+$/)
  })

  /*
   * Чипс под героем — обещание «вот что это за игра». Тег, который карточка
   * покажет чипсом, обязан и исключать: иначе «VR» под героем у того, кто
   * просил без VR, читался бы сломанным фильтром. Поэтому порог любого
   * набора — не меньше числа чипсов. Число чипсов сверено с самим topTags,
   * а не переписано руками.
   */
  test('порог не меньше числа чипсов карточки', () => {
    const many: GameMeta = {
      appid: 1,
      name: 'x',
      tags: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`T${i}`, 100 - i])),
      genres: [],
      categories: [],
    }
    expect(topTags(many)).toHaveLength(CARD_TAGS)
    for (const p of MUTES) expect(p.top, p.key).toBeGreaterThanOrEqual(CARD_TAGS)
  })

  // Предупреждения о контенте судятся по месту среди всех тегов, остальные —
  // среди главных без них (mutedHit): смешанный набор судился бы вразнобой
  test('набор — либо целиком из предупреждений о контенте, либо без них', () => {
    for (const p of MUTES) {
      const warn = p.tags.filter((t) => CONTENT_WARNING_TAGS.has(t)).length
      expect([0, p.tags.length], p.key).toContain(warn)
    }
  })
})

/*
 * Раскрывашка на квизе: aria-controls кнопки обязан указывать на существующий
 * элемент — и у свёрнутой тоже, иначе связь для скринридера ведёт в пустоту.
 * Тот же приём, что у components/landing/LinkHelp: панель в разметке всегда,
 * свёрнутая — через hidden. Серверный кадр — пустой выбор и свёрнуто: так
 * квиз и гидратируется.
 */
describe('MuteTags', () => {
  test('свёрнутая: aria-controls указывает на панель, которая есть в разметке и скрыта', () => {
    const out = renderToStaticMarkup(createElement(MuteTags))
    expect(out).toContain('aria-expanded="false"')
    const controls = out.match(/aria-controls="([^"]+)"/)?.[1]
    expect(controls, 'у кнопки нет aria-controls').toBeTruthy()
    expect(out).toContain(`<div id="${controls}" hidden=""`)
    // чипсы — внутри неё, а не где-то рядом
    expect(out.slice(out.indexOf(`id="${controls}"`))).toContain('aria-pressed="false"')
  })
})

/*
 * /en/quiz: та же панель словами глоссария — «Don't suggest». Язык — из
 * контекста страницы (LocaleProvider), пропса нет; чипсы подписывает
 * muteLabel, MUTES даёт только ключи.
 */
describe('MuteTags по-английски', () => {
  test('свёрнутая строка, имя группы и чипсы — без кириллицы', async () => {
    const { LocaleProvider } = await import('../components/LocaleProvider')
    const out = renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en' } as ComponentProps<typeof LocaleProvider>, createElement(MuteTags)))
    expect(out).toContain('What not to suggest')
    expect(out).toContain('aria-label="Don&#x27;t suggest"')
    for (const p of MUTES) expect(out).toContain(`>${muteLabel(p.key, 'en')}</button>`)
    expect(out).not.toMatch(/[А-Яа-яЁё]/)
  })
})
