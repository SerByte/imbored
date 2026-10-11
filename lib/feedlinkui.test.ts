import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { FeedLink } from '../components/whatsnew/FeedLink'
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

const html = (since: number | null) => renderToStaticMarkup(createElement(FeedLink, { since }))

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

  test('живые строки стоят с первого кадра — пустыми', () => {
    // подтверждение, отказ, удача и «Скопировано»
    expect(html(SINCE).match(/role="status"/g)).toHaveLength(4)
  })
})
