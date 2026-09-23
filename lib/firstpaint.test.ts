import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож правила «анимация не прячет контент».
 *
 * Правило выписано в globals.css у .anim-page-in и звучит так: «анимация
 * может только добавить проявление, но не может спрятать контент». Там оно
 * применено к CSS — и не доехало до motion.
 *
 * А motion рендерит состояние initial ИНЛАЙНОМ УЖЕ НА СЕРВЕРЕ. Проверено на
 * живом сервере: в HTML квиза приезжало style="opacity:0;transform:
 * translateX(24px)" на вопросе и translateY(14px) на каждом ответе. То есть
 * разметка у человека уже была, а экран оставался пустым до конца гидратации
 * — а при сбое чанка или ошибке в соседнем компоненте пустым навсегда.
 *
 * initial={false} у AnimatePresence снимает это ровно для ПЕРВОГО показа:
 * первый шаг появляется сразу, переходы между шагами едут как ехали.
 */

const ROOT = path.join(__dirname, '..')

/** Экраны, чья первая отрисовка приходит с сервера и обязана быть видимой. */
const FIRST_PAINT = [
  { file: path.join('app', 'quiz', 'page.tsx'), what: 'шаг квиза' },
  { file: path.join('components', 'WarmupScreen.tsx'), what: 'подпись экрана прогрева' },
]

describe('первая отрисовка не спрятана анимацией', () => {
  for (const { file, what } of FIRST_PAINT) {
    test(`${what}: AnimatePresence не прячет первый показ`, () => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const tags = [...src.matchAll(/<AnimatePresence[^>]*>/g)].map((m) => m[0])
      expect(tags.length, `${file}: AnimatePresence не найден`).toBeGreaterThan(0)
      for (const tag of tags) {
        expect(tag, `${file}: без initial={false} состояние opacity:0 уедет в серверный HTML`).toContain(
          'initial={false}',
        )
      }
    })
  }

  /**
   * Само правило живёт в комментарии к .anim-page-in. Если его однажды сотрут
   * вместе с fill-mode, тесты выше останутся, а причина исчезнет — и первый же
   * рефакторинг вернёт `both` обратно.
   */
  test('правило по-прежнему записано там, откуда оно взято', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    expect(css).toMatch(/Намеренно БЕЗ fill-mode/)
    expect(css).toMatch(/не может спрятать контент/)
    // и сама анимация не должна обзавестись fill-mode
    const block = css.slice(css.indexOf('.anim-page-in'), css.indexOf('}', css.indexOf('.anim-page-in')))
    expect(block, '.anim-page-in с fill-mode снова спрячет страницу').not.toMatch(/\bboth\b|\bforwards\b/)
  })
})

/**
 * Сторож правила «граница загрузки не прячет страницу».
 *
 * loading.tsx — это <Suspense> вокруг всего сегмента. Пока страница ждёт
 * базу, сервер успевает отдать фолбэк, а настоящее содержимое уезжает в
 * <div hidden> и раскрывается только скриптом. Замер на проде до правки:
 *
 *   /            — спиннер из app/loading.tsx; весь лендинг в скрытом блоке,
 *                  без JS видна одна кнопка Steam;
 *   /game/730    — каркас из app/game/[appid]/loading.tsx, h1 в hidden S:0;
 *   /game/999999999 — HTTP 200, тот же каркас и NEXT_HTTP_ERROR_FALLBACK;404.
 *
 * Последнее — прямое следствие: статус 200 фиксируется, как только отрисован
 * фолбэк, и notFound() после этого уже не может поменять его на 404
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * loading.md, раздел Status Codes). То же с redirect(): гость получал 200 и
 * мета-обновление вместо 307.
 *
 * Поэтому корневого loading.tsx нет, а сегментный допускается только из
 * списка ниже — каждый с причиной. Новый loading.tsx без записи здесь
 * красный: сначала решить, что важнее этой странице — мгновенный каркас при
 * переходе или содержимое и честный статус в первом ответе.
 */
const LOADING_ALLOWED: Record<string, string> = {
  'app/library/loading.tsx':
    'force-dynamic за входом, в robots закрыта: индексировать нечего, а ждать библиотеку из сотен игр долго. ' +
    'Гостя разворачивает proxy.ts до рендера, так что его 307 остаётся честным',
  'app/compat/[steamid]/loading.tsx':
    'force-dynamic, закрыта в robots и noindex: две библиотеки и расчёт совпадения, каркас держит кадр пришедшему из чата',
  'app/portrait/[steamid]/loading.tsx':
    'force-dynamic, закрыта в robots и noindex: самая тяжёлая страница, экран ожидания живёт дольше всего',
  'app/whatsnew/loading.tsx':
    'пока держит кадр при переключении вкладок; прячет h1 в первом ответе и уходит следующей правкой',
}

function loadingFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return loadingFiles(rel)
    return /^loading\.(tsx|ts|jsx|js)$/.test(e.name) ? [rel] : []
  })
}

describe('граница загрузки не прячет страницу', () => {
  test('корневого loading.tsx нет: лендинг, /privacy и /support приходят содержимым', () => {
    expect(loadingFiles('app')).not.toContain('app/loading.tsx')
  })

  test('у страницы игры нет своего loading.tsx: h1 в первом ответе и настоящий 404', () => {
    expect(loadingFiles('app').filter((f) => f.startsWith('app/game/'))).toEqual([])
  })

  test('каждый loading.tsx — из списка и с причиной', () => {
    const found = loadingFiles('app')
    expect(found.length, 'loading.tsx не найдены вовсе — сторож ослеп или список устарел').toBeGreaterThan(0)
    for (const f of found) {
      expect(LOADING_ALLOWED[f], `${f}: новый loading.tsx — запиши причину в LOADING_ALLOWED`).toBeTruthy()
    }
    // и список не гниёт: снятый файл уходит из него вместе с причиной
    for (const f of Object.keys(LOADING_ALLOWED)) {
      expect(found, `${f} снят — убери его из LOADING_ALLOWED`).toContain(f)
    }
  })

  /**
   * Та же граница, заведённая руками, вернула бы всё обратно одной строкой:
   * корневой layout и template оборачивают каждую страницу.
   */
  test('корневой layout и template не оборачивают страницу в Suspense', () => {
    for (const f of ['layout.tsx', 'template.tsx']) {
      const src = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8')
      expect(src, `app/${f}`).not.toMatch(/<Suspense\b/)
    }
  })

  /**
   * notFound() обязан стоять до первого похода в базу: единственное, что
   * отличает мусорный адрес от настоящей игры, — проверка формата, и она не
   * должна ждать ничего.
   */
  test('страница игры отбраковывает мусорный appid до чтения базы', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'game', '[appid]', 'page.tsx'), 'utf8')
    const body = src.slice(src.indexOf('export default async function GamePage'))
    // именно вызов под условием, а не упоминание в комментарии
    const guard = body.search(/\)\s*notFound\(\)/)
    const load = body.indexOf('await loadOnce(')
    expect(guard, 'notFound() в GamePage не найден').toBeGreaterThan(0)
    expect(load, 'loadOnce в GamePage не найден').toBeGreaterThan(0)
    expect(guard).toBeLessThan(load)
  })
})
