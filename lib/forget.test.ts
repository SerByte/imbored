import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { FORGET_TABLES, type ForgetReport } from './db'
import { FORGET_LABELS, forgetCardPaths, forgetSummary } from './forget'

/**
 * Что человек видит перед «Удалить всё обо мне» и что сбрасывается после.
 *
 * Список в подтверждении собирается из того же счёта, что и удаление
 * (countUserRows по USER_ROWS), — второго списка таблиц у него нет. Но
 * подпись к таблице живёт здесь, и новая таблица в USER_ROWS без подписи
 * молча выпала бы из того, что человеку показали перед удалением. Сторож
 * ниже держит обе стороны.
 */

const ME = '76561198000000001'

/** Счёт, где у каждой таблицы списка по n строк */
const report = (n: number, over: Record<string, number> = {}): ForgetReport =>
  FORGET_TABLES.map((table) => ({ table, rows: over[table] ?? n }))

describe('подписи таблиц', () => {
  test('у каждой таблицы удаления есть подпись или осознанное «не показывать»', () => {
    expect(Object.keys(FORGET_LABELS).sort()).toEqual([...FORGET_TABLES].sort())
  })

  /*
   * Голоса и участники считаются и чужие — в комнатах, где он хост, они
   * уходят вместе с комнатой. Число «12 голосов» соврало бы: он отдал три.
   * Поэтому у них строка без числа, одна на всё участие в комнатах.
   */
  test('участие в комнатах — одной строкой без числа: в счёте и чужие голоса', () => {
    const { items } = forgetSummary(report(0, { room_votes: 12, room_members: 4, room_kicks: 1 }))
    expect(items).toEqual(['Участие и голоса в комнатах'])
  })
})

describe('forgetSummary', () => {
  test('показывает только то, что есть, с числом там, где оно что-то значит', () => {
    const { items } = forgetSummary(
      report(0, { users: 1, library_snapshots: 3, feedback: 124, wishlists: 1, sessions: 2 }),
    )
    expect(items).toEqual([
      'Профиль Steam: имя, аватар и портрет',
      'Снимки библиотеки — 3',
      'Список желаемого',
      'Оценки, скрытые игры, свайпы и планы на вечер — 124',
      'Записи о входах — 2',
    ])
  })

  /*
   * Счётчики частоты живут минуты, колода — часть комнаты, отметка прошлого
   * удаления заменяется новой: удаляются они, но в списке «что о тебе
   * хранится» только путали бы.
   */
  test('служебное не показывается', () => {
    const { items } = forgetSummary(report(0, { rate_limits: 5, room_deck: 20, forget_marks: 1 }))
    expect(items).toEqual([])
  })

  test('последствия — только про то, что у человека есть; выход везде — всегда', () => {
    expect(forgetSummary(report(0)).effects).toEqual(['Ты выйдешь на всех устройствах.'])
    const all = forgetSummary(report(1)).effects
    expect(all).toEqual([
      'Портрет и итоги года по твоей ссылке перестанут открываться.',
      'Ссылки на выбор, которые ты отправлял, перестанут открываться.',
      'Превью этих ссылок, которые уже сохранили мессенджеры, отозвать мы не можем.',
      'Комнаты, где ты хост, закроются для всех, кто в них.',
      'Сравнения пропадут и у тех, с кем ты сравнивался.',
      'Ссылка на RSS перестанет работать.',
      'Ты выйдешь на всех устройствах.',
    ])
  })
})

/*
 * Картинки портрета, итогов, сравнения, выбора и комнаты живут в кэше
 * (revalidate в их файлах), и без сброса удалённый человек ещё час
 * разворачивался бы в мессенджерах своей карточкой. Сторож сверяет список
 * сброса с самими маршрутами: новая кэшируемая картинка с данными человека
 * без строки здесь уронит прогон.
 */
describe('forgetCardPaths', () => {
  const ROOT = path.join(__dirname, '..')
  /** Кэшируемые маршруты под сегментами человека: [steamid], выбор и комната */
  function personalCached(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walk(rel)
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
          if (/export const revalidate\b/.test(src)) out.push(rel)
        }
      }
    }
    for (const dir of ['app/portrait', 'app/compat', 'app/pick', 'app/room']) walk(dir)
    return out
  }

  test('каждая кэшируемая картинка с данными человека сбрасывается', () => {
    const files = personalCached()
    expect(files.length, 'кэшируемые маршруты не найдены — сторож ослеп').toBeGreaterThanOrEqual(5)
    const paths = forgetCardPaths(ME, { picks: ['mepick234567'], rooms: ['MYROOM'] })
    for (const file of files) {
      const url = file
        .replace(/^app/, '')
        .replace(/\/(?:route|page)\.tsx?$/, '')
        .replace(/\.tsx?$/, '')
        .replace('[steamid]', ME)
        .replace('/pick/[id]', '/pick/mepick234567')
        .replace('/room/[id]', '/room/MYROOM')
      expect(paths, file).toContain(url)
    }
  })

  test('выборы и комнаты — каждый свой адрес', () => {
    const paths = forgetCardPaths(ME, { picks: ['a', 'b'], rooms: ['R1'] })
    expect(paths).toContain('/pick/a/opengraph-image')
    expect(paths).toContain('/pick/b/opengraph-image')
    expect(paths).toContain('/room/R1/opengraph-image')
  })
})
