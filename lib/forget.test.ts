import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { FORGET_TABLES, type ForgetReport } from './db'
import { FORGET_LABELS, FORGET_LABELS_EN, forgetCardPaths, forgetSummary } from './forget'

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

/** Строка подтверждения про отметку удаления */
const MARK_LINE =
  'Останется только отметка — SteamID и время удаления: по ней старые входы на других устройствах больше не пускают. Через год и месяц она сотрётся сама.'

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

  /*
   * Отметка удаления (forget_marks) остаётся после кнопки всегда: SteamID и
   * время, на год и месяц. /privacy, раздел 06, о ней говорил, а вопрос
   * «Удалить всё?» — нет, и человек, решавший по списку, узнавал о ней разве
   * что из запроса данных через год.
   */
  test('последствия — только про то, что у человека есть; выход везде и отметка удаления — всегда', () => {
    expect(forgetSummary(report(0)).effects).toEqual(['Ты выйдешь на всех устройствах.', MARK_LINE])
    const all = forgetSummary(report(1)).effects
    expect(all).toEqual([
      'Портрет и итоги года по твоей ссылке перестанут открываться.',
      'Ссылки на выбор, которые ты отправлял, перестанут открываться.',
      'Превью этих ссылок, которые уже сохранили мессенджеры, отозвать мы не можем.',
      'Комнаты, где ты хост, закроются для всех, кто в них.',
      'Сравнения пропадут и у тех, с кем ты сравнивался.',
      'Ссылка на RSS перестанет работать.',
      'Ты выйдешь на всех устройствах.',
      MARK_LINE,
    ])
  })
})

/*
 * Об отметке удаления говорят три места: вопрос «Удалить всё?» (выше),
 * строка «всё удалено» на главной (components/landing/HeroNotice) и
 * /privacy, раздел 06. Раньше два из них о ней молчали, и «всё удалено»
 * спорило с SteamID, который на самом деле оставался. Одни и те же три
 * факта — что остаётся, зачем и на сколько — обязаны стоять во всех трёх.
 */
describe('отметка удаления — одними словами везде, где о ней говорят', () => {
  const ROOT = path.join(__dirname, '..')
  const source = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ')
  const places: Array<[string, string]> = [
    ['подтверждение', MARK_LINE],
    ['главная', source('components/landing/HeroNotice.tsx')],
    ['/privacy', source('app/[lang]/privacy/page.tsx')],
  ]

  test.each(places)('%s: что остаётся, зачем и на сколько', (_, text) => {
    // что: SteamID и время, больше ничего
    expect(text).toContain('SteamID и время удаления')
    // зачем: старый вход по ней больше не пускает
    expect(text).toMatch(/пускают|впускать/)
    // на сколько: сама, через год и месяц
    expect(text).toMatch(/через год и месяц/i)
  })
})

/**
 * Тот же вопрос «Удалить всё?» по-английски: те же строки, в том же порядке
 * и с теми же числами — меняются только слова.
 */
describe('forgetSummary по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/
  /** Строка про отметку удаления по-английски */
  const MARK_LINE_EN =
    'Only a marker will remain: your SteamID and the time of deletion. It keeps old sign-ins on other devices from getting back in, and it erases itself after a year and a month.'

  test('у английских подписей те же ключи и то же «не показывать», что у русских', () => {
    expect(Object.keys(FORGET_LABELS_EN).sort()).toEqual(Object.keys(FORGET_LABELS).sort())
    for (const [table, label] of Object.entries(FORGET_LABELS)) {
      expect(FORGET_LABELS_EN[table] === null, table).toBe(label === null)
    }
  })

  test('что хранится — те же строки и числа; число с разрядами', () => {
    const { items } = forgetSummary(
      report(0, { users: 1, library_snapshots: 3, feedback: 1240, wishlists: 1, sessions: 2, room_votes: 12, room_members: 4 }),
      'en',
    )
    expect(items).toEqual([
      'Steam profile: name, avatar and portrait',
      'Library snapshots — 3',
      'Wishlist',
      "Ratings, hidden games, swipes and tonight's plans — 1,240",
      'Room memberships and votes',
      'Sign-in records — 2',
    ])
    // по-русски число — как было, без разрядов
    expect(forgetSummary(report(0, { feedback: 1240 })).items).toEqual([
      'Оценки, скрытые игры, свайпы и планы на вечер — 1240',
    ])
  })

  test('последствия — те же случаи и тот же порядок, что по-русски', () => {
    expect(forgetSummary(report(0), 'en').effects).toEqual(["You'll be signed out on all devices.", MARK_LINE_EN])
    const all = forgetSummary(report(1), 'en').effects
    expect(all).toEqual([
      'Links to your portrait and year in review will stop working.',
      'Pick links you sent will stop working.',
      "We can't take back previews of these links that messaging apps have already saved.",
      'Rooms you host will close for everyone in them.',
      'Comparisons will disappear for the people you compared with, too.',
      'Your RSS link will stop working.',
      "You'll be signed out on all devices.",
      MARK_LINE_EN,
    ])
    expect(all).toHaveLength(forgetSummary(report(1)).effects.length)
  })

  test('ни буквы кириллицы ни в одной строке', () => {
    const { items, effects } = forgetSummary(report(5), 'en')
    expect(items.length).toBeGreaterThan(0)
    for (const line of [...items, ...effects]) expect(line, line).not.toMatch(CYRILLIC)
  })

  /*
   * Те же три факта об отметке, что у русской строки выше. Главная
   * (HeroNotice) и /privacy, раздел 06, по-английски встают в этот же
   * список, когда их переведут, — с теми же тремя проверками.
   */
  test.each([['confirmation', MARK_LINE_EN]])('%s: what stays, why and for how long', (_, text) => {
    expect(text).toContain('SteamID and the time of deletion')
    expect(text).toMatch(/getting back in|let .* back in/)
    expect(text).toMatch(/after a year and a month/i)
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
    for (const dir of ['app/[lang]/portrait', 'app/[lang]/compat', 'app/[lang]/pick', 'app/[lang]/room']) walk(dir)
    return out
  }

  test('каждая кэшируемая картинка с данными человека сбрасывается', () => {
    const files = personalCached()
    expect(files.length, 'кэшируемые маршруты не найдены — сторож ослеп').toBeGreaterThanOrEqual(5)
    const paths = forgetCardPaths(ME, { picks: ['mepick234567'], rooms: ['MYROOM'] })
    for (const file of files) {
      const url = file
        .replace(/^app\/\[lang\]/, '')
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
