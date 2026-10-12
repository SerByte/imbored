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
 *    в lib/lastmoodcaption.
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
 */

const LAYOUT = path.join(ROOT, 'app', 'layout.tsx')
const files = (entry: string) => [...reach(path.join(ROOT, entry)).files].map(rel)
const read = (file: string) => code(fs.readFileSync(path.join(ROOT, file), 'utf8'))

/** Пакеты, которым место в чанке закулисья, а не в первой загрузке */
const IDLE_PACKAGES = ['@vercel/analytics/next', '@vercel/speed-insights/next']

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
]

describe('общий фундамент: лэйаут не везёт того, что не нужно первому кадру', () => {
  const layout = reach(LAYOUT)
  const layoutFiles = [...layout.files].map(rel)

  test('аналитика и Web Vitals — не в статическом графе лэйаута', () => {
    for (const pkg of IDLE_PACKAGES) {
      expect(
        layout.packages.get(pkg),
        `${pkg} снова в первой загрузке каждой страницы — ставь его в components/Backstage.tsx`,
      ).toBeUndefined()
    }
  })

  test('продление входа, тело записки и квиз — тоже', () => {
    expect(
      layoutFiles.filter((f) => LEFT.includes(f)),
      'модуль въехал в общий фундамент — догружай его через import(), как components/BackstageLazy.tsx и components/ReadOnlyNote.tsx',
    ).toEqual([])
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

    const backstage = reach(path.join(ROOT, 'components', 'Backstage.tsx'))
    for (const pkg of IDLE_PACKAGES) expect(backstage.packages.has(pkg), pkg).toBe(true)
    expect([...backstage.files].map(rel)).toEqual(
      expect.arrayContaining(['components/SessionKeeper.tsx', 'lib/sessionhint.ts', 'lib/writer.ts']),
    )

    expect(files('components/ReadOnlyNoteBox.tsx')).toEqual(
      expect.arrayContaining(['lib/destination.ts', 'lib/skiplink.ts', 'lib/focushandoff.ts', 'components/Portal.tsx']),
    )

    expect(files('components/landing/ConnectCard.tsx')).toEqual(
      expect.arrayContaining(['lib/lastmoodcaption.ts', 'lib/quiz.ts']),
    )
  })

  test('увезённое догружается import() из оболочек, которые стоят в лэйауте', () => {
    expect(read('components/BackstageLazy.tsx')).toMatch(/import\(\s*'\.\/Backstage'\s*\)/)
    expect(read('components/ReadOnlyNote.tsx')).toMatch(/import\(\s*'\.\/ReadOnlyNoteBox'\s*\)/)
    const markup = read('app/layout.tsx')
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
  })
})
