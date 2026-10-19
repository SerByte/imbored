import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { code, reach, rel, ROOT } from './testing/importgraph'

/**
 * Сторож общего фундамента: что корневой лэйаут НЕ везёт в первую загрузку
 * каждой страницы.
 *
 * Всё, до чего лэйаут дотягивается статическим импортом, едет общим набором
 * чанков на все 23 маршрута — и на /room/[id] и /play, которые стояли ровно
 * на потолке bundle-budget.json (650 из 650 и 680 из 680). Четыре куска
 * оттуда уехали, потому что первому кадру они не нужны:
 *
 *  - аналитика и полевые Web Vitals (@vercel/analytics, @vercel/speed-insights,
 *    6.7 КБ) и продление входа (SessionKeeper с lib/sessionhint и lib/writer,
 *    2.6 КБ) — разметки у них нет, и работают они в простое после гидратации,
 *    отдельным чанком (components/BackstageLazy);
 *  - тело записки «Режим просмотра» (components/ReadOnlyNoteBox и его
 *    lib/destination, lib/skiplink, lib/focushandoff, components/Portal) —
 *    оно нужно одному входу по ссылке на профиль, и едет, только когда флажок
 *    записки стоит (components/ReadOnlyNote);
 *  - квиз (lib/quiz, его тексты STEPS — 1.2 КБ кириллицы) — его тянула
 *    подпись прошлого настроения, которая нужна одной главной, через
 *    «Подобрать» в шапке (components/PickLink → lib/lastmood). Подпись теперь
 *    в lib/lastmoodcaption;
 *  - пресеты (lib/presets, таблицы с подписями на двух языках) — тем же
 *    путём: lib/lastmood нужен был один playHref. Адреса и разбор параметров
 *    теперь в lib/playhref, без таблиц: −3.0 КБ на 19 маршрутах, где своих
 *    пресетов нет (/daily, /explore, /whatsnew, /rooms, /compat*,
 *    /portrait*, /games*, /privacy, 404…).
 *
 * Замер сборкой (Next 16.3.8, Turbopack, npm run budget) после всех четырёх:
 * общий фундамент 496.9 → 482.9 КБ (−5.1 КБ gzip) — это /privacy, /support,
 * /games и 404; /room/[id] 650.0 → 638.4, /play 680.3 → 671.0, /daily
 * 636.5 → 625.9. Тяжёлым маршрутам досталось меньше: destination и
 * sessionhint они везут и сами.
 *
 * Каждое из этого возвращается одной строкой статического импорта, а сборка
 * проходит зелёной: граф статических импортов (lib/testing/importgraph), как
 * у сторожей gsap и поиска. Граф регуляркой серверное от клиентского не
 * отличает, поэтому список ниже — модули, до которых не дотягивается и
 * серверная часть лэйаута (lib/server и его соседи): иначе сторож краснел бы
 * не по делу.
 *
 * В первую загрузку каждого маршрута сборка кладёт не один лэйаут, а и
 * корневые границы ошибок с шаблоном (app/error.tsx, app/global-error.tsx,
 * app/template.tsx — SHELL ниже). Увезённое вернулось бы через них так же
 * молча, поэтому сторож обходит всех четверых.
 *
 * app/global-error.tsx — ещё и отдельная группа чанков: общий с лэйаутом
 * модуль не делится с ним, а едет второй копией. Так lib/i18n с lib/plural
 * (1.8 КБ) ехал на каждый маршрут дважды — единственный дубль во всей
 * сборке, — пока аварийный экран брал из него splitLocale, tr и lp. Теперь
 * язык адреса — lib/pathlocale без зависимостей, и сторож ниже держит
 * lib/i18n вне графа аварийного экрана: −1.8 КБ на всех 26 маршрутах.
 */

const LAYOUT = path.join(ROOT, 'app', '[lang]', 'layout.tsx')
const files = (entry: string) => [...reach(path.join(ROOT, entry)).files].map(rel)
const read = (file: string) => code(fs.readFileSync(path.join(ROOT, file), 'utf8'))

/** Всё, что едет в первую загрузку каждого маршрута: лэйаут, корневые границы ошибок и шаблон */
const SHELL = ['app/[lang]/layout.tsx', 'app/[lang]/error.tsx', 'app/global-error.tsx', 'app/[lang]/template.tsx']

/**
 * Пакеты, которым место в чанке закулисья, а не в первой загрузке. Пакетом
 * целиком, а не одним входом: '@vercel/analytics/react' или голый
 * '@vercel/speed-insights' везут то же самое.
 */
const IDLE_PACKAGES = ['@vercel/analytics', '@vercel/speed-insights']
const inPackage = (pkg: string) => (spec: string) => spec === pkg || spec.startsWith(`${pkg}/`)
const idle = (spec: string) => IDLE_PACKAGES.some((pkg) => inPackage(pkg)(spec))

/** Модули, которым место в своих чанках — закулисья, записки и главной */
const LEFT = [
  // закулисье: продление входа
  'components/Backstage.tsx',
  'components/SessionKeeper.tsx',
  'lib/sessionhint.ts',
  'lib/writer.ts',
  // тело записки «Режим просмотра»
  'components/ReadOnlyNoteBox.tsx',
  'lib/destination.ts',
  'lib/skiplink.ts',
  'lib/focushandoff.ts',
  'components/Portal.tsx',
  // подпись прошлого настроения
  'lib/lastmoodcaption.ts',
  'lib/quiz.ts',
  // таблицы пресетов: шапке нужен только playHref (lib/playhref)
  'lib/presets.ts',
]

describe('общий фундамент: лэйаут не везёт того, что не нужно первому кадру', () => {
  const layout = reach(LAYOUT)
  const layoutFiles = [...layout.files].map(rel)

  // объединение графов всего, что едет в первую загрузку каждого маршрута
  const shellFiles = new Set<string>()
  const shellPackages = new Map<string, string>()
  for (const entry of SHELL) {
    const graph = reach(path.join(ROOT, entry))
    for (const f of graph.files) shellFiles.add(rel(f))
    for (const [pkg, by] of graph.packages) if (!shellPackages.has(pkg)) shellPackages.set(pkg, by)
  }

  test('аналитика и Web Vitals — не в статическом графе лэйаута и корневых границ', () => {
    const back = [...shellPackages].filter(([pkg]) => idle(pkg)).map(([pkg, by]) => `${pkg} ← ${by}`)
    expect(back, 'аналитика снова в первой загрузке каждой страницы — ставь её в components/Backstage.tsx').toEqual([])
  })

  test('продление входа, тело записки, квиз и пресеты — тоже', () => {
    expect(
      [...shellFiles].filter((f) => LEFT.includes(f)),
      'модуль въехал в общий фундамент — догружай его через import(), как components/BackstageLazy.tsx и components/ReadOnlyNote.tsx',
    ).toEqual([])
  })

  test('сторож узнаёт пакет аналитики по любому входу', () => {
    for (const pkg of IDLE_PACKAGES) {
      for (const spec of [pkg, `${pkg}/next`, `${pkg}/react`]) expect(idle(spec), spec).toBe(true)
    }
    expect(idle('@vercel/analytics-extra'), 'чужой пакет с похожим именем').toBe(false)
  })

  /*
   * Без этого сторожа выше могли бы быть зелёными потому, что обход сломан
   * или модуль переименован: каждый увезённый кусок обязан быть найден там,
   * куда его увезли.
   */
  test('обход находит увезённое там, где ему место', () => {
    expect(layoutFiles).toEqual(
      expect.arrayContaining([
        'components/BackstageLazy.tsx',
        'components/ReadOnlyNote.tsx',
        'lib/readonlynote.ts',
        'components/PickLink.tsx',
        'lib/lastmood.ts',
      ]),
    )

    for (const entry of SHELL) expect(shellFiles.has(entry), `${entry} — обход его не нашёл`).toBe(true)

    const backstage = reach(path.join(ROOT, 'components', 'Backstage.tsx'))
    for (const pkg of IDLE_PACKAGES) expect([...backstage.packages.keys()].some(inPackage(pkg)), pkg).toBe(true)
    expect([...backstage.files].map(rel)).toEqual(
      expect.arrayContaining(['components/SessionKeeper.tsx', 'lib/sessionhint.ts', 'lib/writer.ts']),
    )

    expect(files('components/ReadOnlyNoteBox.tsx')).toEqual(
      expect.arrayContaining(['lib/destination.ts', 'lib/skiplink.ts', 'lib/focushandoff.ts', 'components/Portal.tsx']),
    )

    expect(files('components/landing/ConnectCard.tsx')).toEqual(
      expect.arrayContaining(['lib/lastmoodcaption.ts', 'lib/quiz.ts', 'lib/presets.ts']),
    )

    expect(files('lib/lastmood.ts')).toContain('lib/playhref.ts')
    expect(files('lib/destination.ts')).toContain('lib/playhref.ts')
    expect(files('app/global-error.tsx')).toContain('lib/pathlocale.ts')
  })

  /*
   * Аварийный экран — своя группа чанков первой загрузки, и общий с лэйаутом
   * модуль едет в неё второй копией (см. докблок выше). lib/i18n в его графе —
   * это 1.8 КБ дубля на каждом маршруте. Тип из lib/i18n брать можно: import
   * type в сборку не попадает, и обход его пропускает.
   */
  test('аварийный экран не везёт вторую копию lib/i18n', () => {
    const shown = files('app/global-error.tsx')
    expect(shown, 'язык адреса — pathLocale из lib/pathlocale, строки — парой без tr()').not.toContain('lib/i18n.ts')
    expect(shown).not.toContain('lib/plural.ts')
  })

  test('увезённое догружается import() из оболочек, которые стоят в лэйауте', () => {
    expect(read('components/BackstageLazy.tsx')).toMatch(/import\(\s*'\.\/Backstage'\s*\)/)
    expect(read('components/ReadOnlyNote.tsx')).toMatch(/import\(\s*'\.\/ReadOnlyNoteBox'\s*\)/)
    const markup = read('app/[lang]/layout.tsx')
    expect(markup).toContain('<Backstage />')
    expect(markup).toContain('<ReadOnlyNote />')
  })

  /*
   * Главная продлевает вход сама (ей нужен ответ) и отмечает это для
   * SessionKeeper. Отметка — в lib/sessiontouch: импорт ради неё из
   * components/SessionKeeper вёз бы в первую загрузку главной весь
   * компонент, которому на главной делать нечего.
   */
  test('главная отмечает продление, не везя SessionKeeper', () => {
    const card = files('components/landing/ConnectCard.tsx')
    expect(card).toContain('lib/sessiontouch.ts')
    expect(card).not.toContain('components/SessionKeeper.tsx')
    expect(files('components/SessionKeeper.tsx')).toContain('lib/sessiontouch.ts')
  })

  test('«Подобрать» в шапке знает прошлое настроение, но не квиз', () => {
    const pick = files('components/PickLink.tsx')
    expect(pick).toContain('lib/lastmood.ts')
    expect(pick, 'тексты квиза снова в шапке каждой страницы').not.toContain('lib/quiz.ts')
    expect(pick, 'таблицы пресетов снова в шапке каждой страницы — playHref бери из lib/playhref').not.toContain(
      'lib/presets.ts',
    )
  })

  /*
   * Не фундамент, но тот же довод: «Отправить другу» у героя /play и /daily
   * нужен один адрес выбора. lib/sharedpick и lib/comeback при загрузке
   * модуля собирают регулярки (new RegExp(String.raw…), Object.values
   * PATCH_SINCE_LEADS), и сборщик их не выбросит — импорт оттуда вёз бы их в
   * первую загрузку обеих страниц. PickKind — тоже из lib/pickurl (или
   * `import type`): тип рядом с импортом значения (`{ x, type PickKind }`)
   * модуль из сборки не убирает, и обход считает такой импорт настоящим.
   */
  test('«Отправить другу» берёт адрес выбора без регулярок lib/sharedpick', () => {
    const share = files('components/SharePick.tsx')
    expect(share).toContain('lib/pickurl.ts')
    expect(share).not.toContain('lib/sharedpick.ts')
    expect(share).not.toContain('lib/comeback.ts')
  })
})
