import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож дверей к модели.
 *
 * Ключ Anthropic — единственный расходник продукта, который тратится молча и
 * замечается только в биллинге. Потолки на него живут в коде маршрутов, а
 * маршрут — самое лёгкое место, чтобы потолок потерять: достаточно завести
 * новую страницу, которая зовёт модель на рендере, и никто не узнает.
 *
 * ИМЕННО ТАК И СЛУЧИЛОСЬ. Потолки ставились на /api/recommend, и в тот же день
 * было заявлено, что расход закрыт. Он не был закрыт: /portrait/[steamid] —
 * публичная страница, которой делятся ссылкой, — звала claudePortraitText на
 * рендере, сессию читала строкой НИЖЕ вызова и только ради переключателя в
 * интерфейсе. Проверено на подменённом эндпоинте: цепочка «взять демо-сессию
 * даром → открыть /portrait/<id>» уходила в Anthropic на каждом холодном
 * рендере, без единой куки в запросе. Пятую дверь никто не искал, потому что
 * искать было нечем.
 *
 * Правило простое: КАЖДЫЙ файл, который тянет из lib/llm функцию claude*,
 * обязан рядом иметь либо потолок (checkRate), либо крон-секрет
 * (cronAuthorized). Третьего не дано — «эта страница дешёвая» и «сюда всё
 * равно никто не ходит» кончаются одинаково.
 *
 * Сторож читает исходники, а не типы: он должен ловить и то, что написано
 * завтра, а не только то, что существует сегодня.
 */

const ROOT = path.join(__dirname, '..')

/*
 * Импорт ИМЕННО дорогой функции, а не любой из lib/llm.
 *
 * В том же модуле живёт heuristicPicks — чистая функция без единого сетевого
 * вызова, и её зовут /api/daily и lib/landing. Требовать от них потолка значило
 * бы завести сторожа, которого обходят формальной строчкой.
 *
 * Опора на имя: всё, что создаёт клиент Anthropic, называется claude*. Это не
 * соглашение на честном слове — ниже стоит отдельная проверка самого lib/llm.ts.
 */
const LLM_MODULE = /import\s*\{[^}]*\bclaude[A-Z]\w*[^}]*\}\s*from\s*'(@\/lib\/llm|\.\/llm)'/

/**
 * Прослойки, которые модель зовут, но потолок держать не могут: у них нет ни
 * запроса, ни адреса клиента. За них отвечает тот, кто их вызывает, — и это
 * проверяется вторым правилом ниже.
 */
const LIBRARY_LAYER = new Set(['lib/newsjob.ts', 'lib/pagejob.ts'])

function sourceFiles(): [string, string][] {
  const out: [string, string][] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        walk(p)
      } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
        out.push([path.relative(ROOT, p).replace(/\\/g, '/'), fs.readFileSync(p, 'utf8')])
      }
    }
  }
  for (const dir of ['app', 'lib', 'components']) walk(path.join(ROOT, dir))
  return out
}

/** Комментарии выкидываем: докблок про потолок — не потолок. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}

describe('двери к модели', () => {
  const files = sourceFiles()

  test('каждый вызывающий lib/llm закрыт потолком или крон-секретом', () => {
    const naked: string[] = []
    for (const [file, src] of files) {
      if (file === 'lib/llm.ts' || LIBRARY_LAYER.has(file)) continue
      const code = withoutComments(src)
      if (!LLM_MODULE.test(code)) continue
      if (code.includes('checkRate') || code.includes('cronAuthorized')) continue
      naked.push(file)
    }
    expect(
      naked,
      'файл зовёт модель без потолка — поставь checkRate из lib/ratelimit до вызова',
    ).toEqual([])
  })

  /**
   * Прослойки отвечают не за себя, а за своих вызывающих: newsjob и pagejob
   * ходят в модель пачками из крона, и вся их защита — крон-секрет.
   */
  test('пересказы и pros/cons запускаются только из-под крон-секрета', () => {
    const callers: string[] = []
    for (const [file, src] of files) {
      const code = withoutComments(src)
      if (!/from '@\/lib\/(newsjob|pagejob)'/.test(code)) continue
      callers.push(file)
      expect(code, `${file} запускает пачку в модель без cronAuthorized`).toContain(
        'cronAuthorized',
      )
    }
    // Если вызывающих не осталось вовсе — правило молчит, а не зеленеет впустую.
    expect(callers.length, 'некому запускать newsjob/pagejob — проверь, не отвалился ли крон').
      toBeGreaterThan(0)
  })

  /**
   * Сам сторож обязан ловить. Кормим ему ту самую страницу, ради которой он
   * заведён, — в том виде, в каком она жила в проде.
   */
  test('сторож ловит страницу, которая зовёт модель без потолка', () => {
    const bad = `
      import { claudePortraitText } from '@/lib/llm'
      export default async function P() {
        const text = await claudePortraitText({})
        const me = await currentSteamId()
        return text
      }
    `
    const code = withoutComments(bad)
    expect(LLM_MODULE.test(code)).toBe(true)
    expect(code.includes('checkRate') || code.includes('cronAuthorized')).toBe(false)
  })

  /**
   * Всё правило выше держится на имени claude*. Значит, имя обязано быть
   * правдой: новая функция с клиентом Anthropic внутри и нейтральным именем
   * прошла бы мимо сторожа незамеченной.
   */
  test('всё, что создаёт клиент Anthropic, называется claude*', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/llm.ts'), 'utf8')
    const lines = withoutComments(src).split('\n')
    let current = ''
    const offenders: string[] = []
    lines.forEach((ln) => {
      const decl = /export\s+(?:async\s+)?function\s+(\w+)/.exec(ln)
      if (decl) current = decl[1]
      if (ln.includes('new Anthropic') && !/^claude[A-Z]/.test(current)) {
        offenders.push(current || '<вне функции>')
      }
    })
    expect(
      offenders,
      'функция ходит в Anthropic, но не названа claude* — сторож дверей её не увидит',
    ).toEqual([])
  })

  test('докблок про потолок за потолок не считается', () => {
    const bad = `
      /* Потолок тут не нужен: checkRate стоит выше по стеку. */
      import { claudePicks } from '@/lib/llm'
      export async function POST() { return claudePicks({}) }
    `
    const code = withoutComments(bad)
    expect(code.includes('checkRate')).toBe(false)
  })
})
