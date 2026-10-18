import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { FeedLink } from '../components/whatsnew/FeedLink'
import { bounceTo, steamLoginFor } from './destination'
import { issueReply } from './feedlinkreply'
import { dateLabel } from './freshness'

/**
 * Строка «RSS по секретной ссылке» на /whatsnew — в первом кадре, как её
 * отдаёт сервер.
 *
 * Ссылку сервер не знает (в базе только отпечаток), поэтому включённая
 * ссылка рисуется датой выпуска и кнопками, а не адресом, — и страница
 * прямо говорит, что показать её снова нельзя. Строки отказов и
 * подтверждений стоят в разметке с первого кадра: иначе их текст звучал бы
 * не везде (components/StatusLine).
 */

const SINCE = 1_760_000_000

const html = (since: number | null, verified = true) =>
  renderToStaticMarkup(createElement(FeedLink, { since, verified }))

describe('FeedLink: первый кадр', () => {
  test('ссылки нет — одна кнопка выпуска и предупреждение, что ссылка личная', () => {
    const out = html(null)
    expect(out).toContain('RSS по секретной ссылке')
    expect(out).toContain('Получить ссылку')
    expect(out).toContain('не публикуй её')
    expect(out).not.toContain('Отключить')
    expect(out).not.toContain('Выпустить новую')
  })

  test('ссылка есть — дата выпуска, «показать нельзя», перевыпуск и отключение; поля с адресом нет', () => {
    const out = html(SINCE)
    expect(out).toContain(`Ссылка выдана ${dateLabel(SINCE, { year: true })}`)
    expect(out).toContain('показать её снова нельзя')
    // «2025 г.» и точка предложения не склеиваются в «г..»
    expect(out).not.toContain('..')
    expect(out).toContain('Выпустить новую')
    expect(out).toContain('Отключить')
    expect(out).toContain('Выйти на всех устройствах')
    expect(out).not.toContain('<input')
    expect(out).not.toContain('/whatsnew/feed/')
  })

  /**
   * Демо пишет и ссылку выпускает, но «Выйти на всех устройствах» у него нет
   * (components/SignOut), и его выход ссылку не трогает. Обещать ему этот
   * выключатель — обещать кнопку, которой он не найдёт.
   */
  test('второй выключатель «Выйти на всех устройствах» обещан только вошедшему через Steam', () => {
    expect(html(SINCE, false)).not.toContain('Выйти на всех устройствах')
    expect(html(SINCE, false)).toContain('Отключить')
    expect(html(null, true)).not.toContain('Выйти на всех устройствах')
  })

  /**
   * Демо-личность пишет и ссылку выпускает (requireWriter), но библиотека у
   * неё чужая, а сама личность уходит уборкой через неделю без вестей
   * (sweepStale в lib/db) — вместе со ссылкой: ридер её опросы признаком
   * жизни не считает. Обещание «патчи твоих игр» и «видит, какие игры у тебя
   * есть» было неправдой, а ридер через неделю-другую тихо получал 404.
   */
  test('демо: лента демо-библиотеки, срок жизни ссылки и вход через Steam за своей', () => {
    // чья лента — говорится до выпуска, там же, где у вошедшего «твоих игр»
    expect(html(null, false)).toContain('Патчи игр демо-библиотеки')
    // «без захода сюда» спорило бы со сроком ниже: демо-ссылка живёт заходами
    expect(html(null, false)).not.toContain('без захода сюда')
    // а срок и вход за своей — при любой фазе: ссылку кладут в ридер уже выпущенной
    for (const since of [null, SINCE]) {
      const out = html(since, false)
      expect(out, String(since)).toContain('пока жив демо-профиль')
      expect(out, String(since)).toContain('перестанет работать через неделю-другую без заходов на сайт')
      expect(out, String(since)).toContain('href="/api/auth/steam?next=%2Fwhatsnew"')
      expect(out, String(since)).not.toContain('твоих игр')
      expect(out, String(since)).not.toContain('какие игры у тебя есть')
    }
    // вошедшему через Steam — прежние слова: лента его, ссылка живёт до отзыва
    const own = html(null, true)
    expect(own).toContain('Патчи твоих игр')
    expect(own).toContain('какие игры у тебя есть')
    expect(own).not.toContain('демо')
    expect(html(SINCE, true)).not.toContain('демо')
  })

  test('живые строки стоят с первого кадра — пустыми', () => {
    // подтверждение, отказ, удача и «Скопировано»
    expect(html(SINCE).match(/role="status"/g)).toHaveLength(4)
  })
})

/**
 * Разбор ответа на выпуск (lib/feedlinkreply). Строка FeedLink по нему
 * решает, показать адрес, переспросить про замену или сказать отказ
 * словами. Ответ «уже есть» обязан узнаваться: иначе вкладка со старым
 * кадром сказала бы «не получилось» тому, чья ссылка цела.
 */
describe('FeedLink: ответ на выпуск', () => {
  const reply = (status: number, body: unknown) =>
    issueReply(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )

  test('выпущена — путь с ключом', async () => {
    expect(await reply(200, { path: '/whatsnew/feed/abc', createdAt: SINCE })).toEqual({
      kind: 'shown',
      path: '/whatsnew/feed/abc',
    })
  })

  test('409 exists — ссылка цела, и с какого она дня', async () => {
    expect(await reply(409, { error: 'exists', since: SINCE })).toEqual({ kind: 'exists', since: SINCE })
  })

  test('остальное — отказ, его словами разбирает сама строка', async () => {
    for (const [status, body] of [
      [401, { error: 'nosession' }],
      [403, { error: 'needsteam' }],
      [429, { error: 'ratelimited' }],
      [500, 'не json'],
      // 409 без даты или с чужим кодом — не «уже есть»
      [409, { error: 'exists' }],
      [409, { error: 'other', since: SINCE }],
      // удача без пути показать нечего
      [200, { createdAt: SINCE }],
    ] as const) {
      expect(await reply(status, body), `${status} ${JSON.stringify(body)}`).toEqual({ kind: 'refused' })
    }
  })

  /*
   * Кликов здесь не нажать — DOM в прогоне нет, — поэтому проводка сверяется
   * по исходнику: replace: true уходит ровно из одного места, из ветки
   * переспроса, а «Получить ссылку» без подтверждения замены не просит.
   */
  test('замену просит только «Да, выпустить новую»', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'whatsnew', 'FeedLink.tsx'), 'utf8')
    expect(src.match(/issue\(true\)/g)).toHaveLength(1)
    expect(src).toMatch(/if \(asking\) \{\s*void issue\(true\)/)
    expect(src).toMatch(/if \(phase\.kind === 'off'\) \{\s*void issue\(false\)/)
    // и тело действительно несёт просьбу
    expect(src).toContain('body: JSON.stringify({ replace })')
  })

  /*
   * «Вход закончился — войди снова» (401) обещает вход, а вёл на голую
   * главную: после входа человек попадал на квиз, а не к ссылке, ради
   * которой жал «Получить ссылку». Вошедшему через Steam — сразу вход через
   * Steam: 401 приходит и после «Выйти на всех устройствах» с другого
   * устройства, а главная по тёплому кэшу сессии встретила бы его как
   * вошедшего и вернула к тому же 401. Демо — через главную с возвратом:
   * там и демо, и Steam, а в Steam он и не входил.
   */
  test('«войди снова» после 401 возвращает на /whatsnew, а не на голую главную', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'whatsnew', 'FeedLink.tsx'), 'utf8')
    expect(src).not.toMatch(/href=(?:"\/"|\{'\/'\})/)
    const at = src.indexOf('if (res.status === 401) {')
    expect(at).toBeGreaterThan(-1)
    const branch = src.slice(at, src.indexOf('if (res.status === 429)', at))
    expect(branch).toContain("href={verified ? steamLoginFor('/whatsnew') : lp(locale, bounceTo('/whatsnew'))}")
    expect(bounceTo('/whatsnew')).toBe('/?next=%2Fwhatsnew')
    expect(steamLoginFor('/whatsnew')).toBe('/api/auth/steam?next=%2Fwhatsnew')
  })

  test('тело читается с копии — отказ потом разберёт isNeedSteam', async () => {
    const res = new Response(JSON.stringify({ error: 'needsteam' }), { status: 403 })
    await issueReply(res)
    expect(res.bodyUsed).toBe(false)
  })
})
