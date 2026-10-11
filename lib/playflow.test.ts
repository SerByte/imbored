import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  BURNOUT_AFTER_SKIPS,
  FRESH_TURN,
  afterBan,
  burnoutInvite,
  burnoutOffer,
  dealFrom,
  landingIndex,
  nextStep,
  switchLine,
  weightedRandomIndex,
} from './playflow'

/** random(), который отдаёт заранее заданные числа по кругу */
function seq(...xs: number[]): () => number {
  let i = 0
  return () => xs[i++ % xs.length]
}

describe('dealFrom', () => {
  const pick = { appid: 730, name: 'Counter-Strike 2', tags: [] }

  test('пустая выдача — не выдача', () => {
    expect(dealFrom({ picks: [], engine: 'heuristic', nowSec: 1 }, 'all')).toBeNull()
    expect(dealFrom({ engine: 'heuristic' }, 'all')).toBeNull()
    expect(dealFrom(null, 'all')).toBeNull()
    expect(dealFrom('oops', 'all')).toBeNull()
  })

  test('необязательное — пустым, а не undefined', () => {
    const d = dealFrom({ picks: [pick], engine: 'claude', nowSec: 100 }, 'library')
    expect(d).toMatchObject({
      discoveries: [],
      continueGame: null,
      engine: 'claude',
      lean: null,
      scope: 'library',
      seed: null,
      nowSec: 100,
    })
  })

  test('затравка «Как «X», но…» — из эха; мусор — обычная выдача', () => {
    const seed = { appid: 1145360, name: 'Hades' }
    expect(dealFrom({ picks: [pick], nowSec: 1, seed }, 'all')?.seed).toEqual(seed)
    for (const bad of [null, 'Hades', { appid: 1.5, name: 'Hades' }, { appid: 7 }, { appid: 0, name: 'X' }]) {
      expect(dealFrom({ picks: [pick], nowSec: 1, seed: bad }, 'all')?.seed, JSON.stringify(bad)).toBeNull()
    }
  })

  test('ось — из эха сервера, источник — из запроса', () => {
    const d = dealFrom({ picks: [pick], engine: 'claude', lean: 'fresh', scope: 'library', nowSec: 1 }, 'all')
    expect(d?.lean).toBe('fresh')
    // при фокусе сервер подменяет источник на library, переключателю это эхо не нужно
    expect(d?.scope).toBe('all')
  })

  test('скрытое время — только из явного true: мусор и старый сервер молчат о галочке', () => {
    expect(dealFrom({ picks: [pick], nowSec: 1, playtimeHidden: true }, 'all')?.playtimeHidden).toBe(true)
    for (const v of [undefined, false, 'true', 1]) {
      expect(dealFrom({ picks: [pick], nowSec: 1, playtimeHidden: v }, 'all')?.playtimeHidden, String(v)).toBe(false)
    }
  })

  test('мусор в оси — «без оси», а не строка, которой нет среди кнопок', () => {
    expect(dealFrom({ picks: [pick], lean: 'sideways', nowSec: 1 }, 'all')?.lean).toBeNull()
  })

  test('без серверных часов — ноль, а не NaN в подписи онлайна', () => {
    expect(dealFrom({ picks: [pick], nowSec: 'soon' }, 'all')?.nowSec).toBe(0)
  })

  test('чья выдача — из ответа; без неё null, и запись на устройстве не заведётся', () => {
    expect(dealFrom({ picks: [pick], nowSec: 1, viewer: '76561197960287930' }, 'all')?.viewer).toBe(
      '76561197960287930',
    )
    expect(dealFrom({ picks: [pick], nowSec: 1 }, 'all')?.viewer).toBeNull()
    expect(dealFrom({ picks: [pick], nowSec: 1, viewer: '' }, 'all')?.viewer).toBeNull()
  })
})

describe('FRESH_TURN', () => {
  test('новая выдача закрывает вопрос о причине и «Почему она?» и обнуляет пропуски', () => {
    expect(FRESH_TURN).toEqual({ dir: 'pick', askReason: false, showWhy: false, skipCount: 0 })
  })

  test('общий на все пути — и потому неизменяемый', () => {
    expect(Object.isFrozen(FRESH_TURN)).toBe(true)
  })
})

describe('weightedRandomIndex', () => {
  test('ранние позиции весят больше: у пятёрки веса 5, 4, 3, 2, 1', () => {
    // сумма 15; 0.33·15 = 4.95 ≤ 5 → первая, 0.34·15 = 5.1 → вторая
    expect(weightedRandomIndex(5, undefined, () => 0.33)).toBe(0)
    expect(weightedRandomIndex(5, undefined, () => 0.34)).toBe(1)
    expect(weightedRandomIndex(5, undefined, () => 0.99)).toBe(4)
  })

  test('исключённая позиция не выпадает даже на краях random()', () => {
    for (const r of [0, 0.0001, 0.5, 0.9999, 1]) {
      expect(weightedRandomIndex(5, 0, () => r), `random=${r}`).not.toBe(0)
      expect(weightedRandomIndex(5, 4, () => r), `random=${r}`).not.toBe(4)
    }
  })

  test('из одной карточки исключать нечего — выпадает она же', () => {
    expect(weightedRandomIndex(1, 0, () => 0.7)).toBe(0)
  })
})

describe('landingIndex', () => {
  test('без рулетки новая выдача начинается с лучшей карточки', () => {
    expect(landingIndex(5, false, () => 0.99)).toBe(0)
  })

  test('в рулетке — бросок', () => {
    expect(landingIndex(5, true, () => 0.99)).toBe(4)
  })
})

describe('nextStep', () => {
  test('без рулетки — следующая по ленте, с последней на первую', () => {
    expect(nextStep({ from: 0, length: 5, roulette: false, skipCount: 0 })).toEqual({
      burnout: false,
      skipCount: 1,
      to: 1,
    })
    expect(nextStep({ from: 4, length: 5, roulette: false, skipCount: 1 })).toMatchObject({ to: 0 })
  })

  test('пятый пропуск подряд — экран выгорания, а не следующая карточка', () => {
    expect(nextStep({ from: 2, length: 5, roulette: false, skipCount: BURNOUT_AFTER_SKIPS - 1 })).toEqual({
      burnout: true,
      skipCount: BURNOUT_AFTER_SKIPS,
    })
  })

  test('«Крутить ещё» не выбрасывает ту же игру', () => {
    const random = seq(0, 0.2, 0.5, 0.8, 0.9999)
    for (let i = 0; i < 5; i++) {
      const step = nextStep({ from: 0, length: 5, roulette: true, skipCount: 0 }, random)
      expect(step.burnout).toBe(false)
      if (!step.burnout) expect(step.to).not.toBe(0)
    }
  })
})

describe('switchLine', () => {
  test('потолок частоты называет срок — в минутах и с верным склонением', () => {
    expect(switchLine({ miss: 'limited', waitSec: 60 })).toBe('Слишком часто — попробуй через 1 минуту')
    expect(switchLine({ miss: 'limited', waitSec: 150 })).toBe('Слишком часто — попробуй через 3 минуты')
    expect(switchLine({ miss: 'limited', waitSec: 600 })).toBe('Слишком часто — попробуй через 10 минут')
  })

  test('окно в секунды — «через 1 минуту», а не «через 0 минут»', () => {
    expect(switchLine({ miss: 'limited', waitSec: 7 })).toBe('Слишком часто — попробуй через 1 минуту')
  })

  test('без Retry-After срок не выдумывается', () => {
    expect(switchLine({ miss: 'limited', waitSec: null })).toBe('Слишком часто — попробуй чуть позже')
  })

  test('прочий отказ говорит, что выдача на экране прежняя', () => {
    expect(switchLine({ miss: 'failed', code: null })).toBe('Не получилось переключить, выдача прежняя')
    expect(switchLine({ miss: 'failed', code: 'nolibrary' })).toBe('Не получилось переключить, выдача прежняя')
  })

  test('кандидатов нет — не сбой, и повтор не обещается', () => {
    const line = switchLine({ miss: 'failed', code: 'nocandidates' })
    expect(line).toBe('Под это ничего не нашлось, выдача прежняя')
  })

  test('сессия кончилась — молчим: страница уже уходит на вход', () => {
    expect(switchLine({ miss: 'gone' })).toBeNull()
  })
})

describe('afterBan', () => {
  const deal = (...ids: number[]) => ids.map((appid) => ({ appid }))
  const ids = (r: ReturnType<typeof afterBan<{ appid: number }>>) => (r.empty ? [] : r.picks.map((p) => p.appid))

  test('герой и есть забаненная — на её место встаёт следующая', () => {
    const r = afterBan({ picks: deal(1, 2, 3), index: 1, banned: 2 })
    expect(r).toMatchObject({ empty: false, index: 1, heroGone: true })
    expect(ids(r)).toEqual([1, 3])
  })

  test('забанили последнюю — герой становится новой последней, а не пустотой', () => {
    const r = afterBan({ picks: deal(1, 2, 3), index: 2, banned: 3 })
    expect(r).toMatchObject({ empty: false, index: 1, heroGone: true })
  })

  /*
   * Бан ждёт сервер, а остальной экран — нет: пока шёл запрос, человек выбрал
   * карточку из «Ещё вариантов» или пролистал «дальше». Индекс из замыкания
   * клика увёл бы героя на соседа забаненной — на игру, которую не выбирали.
   */
  test('пока шёл бан, герой сменился — он и остаётся героем', () => {
    const picked = afterBan({ picks: deal(1, 2, 3, 4), index: 3, banned: 2 })
    expect(picked).toMatchObject({ empty: false, heroGone: false })
    expect(ids(picked)).toEqual([1, 3, 4])
    if (!picked.empty) expect(picked.picks[picked.index].appid).toBe(4)

    const passed = afterBan({ picks: deal(1, 2, 3), index: 2, banned: 1 })
    if (!passed.empty) expect(passed.picks[passed.index].appid).toBe(3)
  })

  test('пока шёл бан, пришла новая выдача без этой игры — выдача не трогается', () => {
    const r = afterBan({ picks: deal(7, 8, 9), index: 1, banned: 2 })
    expect(r).toMatchObject({ empty: false, index: 1, heroGone: false })
    expect(ids(r)).toEqual([7, 8, 9])
  })

  test('забанили единственную — выдачи не осталось', () => {
    expect(afterBan({ picks: deal(5), index: 0, banned: 5 })).toEqual({ empty: true })
  })
})

describe('экран выгорания', () => {
  test('предлагает по убыванию сил: знакомое, начатое, уютное', () => {
    expect(burnoutOffer({ familiar: true, cont: true, cozy: true })).toBe('familiar')
    expect(burnoutOffer({ familiar: false, cont: true, cozy: true })).toBe('continue')
    expect(burnoutOffer({ familiar: false, cont: false, cozy: true })).toBe('cozy')
    expect(burnoutOffer({ familiar: false, cont: false, cozy: false })).toBeNull()
  })

  /*
   * Абзац говорил «зайти на 20 минут во что-то уютное» всегда, а кнопка под
   * ним была «Просто продолжить «Dota 2»» — сорок минут рейтинга. Абзац
   * обязан звать туда же, куда кнопка.
   */
  test('«уютное» и «20 минут» обещает только тот абзац, под которым уютная игра', () => {
    expect(burnoutInvite('cozy')).toContain('20 минут во что-то уютное')
    for (const o of ['familiar', 'continue', null] as const) {
      expect(burnoutInvite(o), String(o)).not.toMatch(/уютн|20 минут/)
    }
    expect(burnoutInvite('continue')).toMatch(/продолжить/)
    expect(burnoutInvite('familiar')).toMatch(/знаком/)
  })

  test('выход «просто закрыть Steam» есть всегда, и без кнопки абзац никуда не зовёт', () => {
    for (const o of ['familiar', 'continue', 'cozy', null] as const) {
      expect(burnoutInvite(o), String(o)).toMatch(/закрыть Steam, и это тоже победа\.$/)
    }
    expect(burnoutInvite(null)).toBe('Можно просто закрыть Steam, и это тоже победа.')
  })
})

/**
 * Сторож одной двери. Новую выдачу на экран кладёт только applyDeal: если
 * какой-то путь снова начнёт раскладывать ответ сам, он снова забудет сбросить
 * половину состояния — ровно то, что здесь чинили.
 */
describe('/play применяет новую выдачу одной функцией', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'play', 'page.tsx'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  test('поля выдачи пишутся в одном месте', () => {
    for (const setter of [
      'setDiscoveries(',
      'setContinueGame(',
      'setTimeHidden(',
      'setEngine(',
      'setNowSec(',
      'setScope(',
      'setSeed(',
      'setNudge(',
    ]) {
      expect(code.split(setter).length - 1, setter).toBe(1)
    }
  })

  test('каждый ответ fetchPicks уходит в applyDeal', () => {
    const lines = code.split('\n')
    const calls = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /fetchPicks\(\{|fetchPicks\(next\)/.test(line))
    // первая выдача, «Попробовать снова», переключатели, «Обновить выдачу»
    expect(calls.length).toBeGreaterThanOrEqual(4)
    for (const { i } of calls) {
      expect(lines.slice(i, i + 10).join('\n'), `app/play/page.tsx:${i + 1}`).toContain('applyDeal(')
    }
  })

  test('applyDeal сбрасывает экран из FRESH_TURN, а не своими литералами', () => {
    const body = code.slice(code.indexOf('const applyDeal'), code.indexOf('useEffect(', code.indexOf('const applyDeal')))
    for (const key of ['dir', 'askReason', 'showWhy', 'skipCount']) {
      expect(body, key).toContain(`FRESH_TURN.${key}`)
    }
  })
})

/**
 * Сторожа экрана выдачи, которые не проверить без браузера иначе как по
 * исходнику. Каждый держит одну найденную аудитом поломку: правка, которая её
 * вернёт, выглядит безобидно и проходит все тесты поведения.
 */
describe('/play: пути вокруг выдачи', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'play', 'page.tsx'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  /** Кусок кода от первого from до первого to после него */
  const between = (from: string, to: string) => {
    const at = code.indexOf(from)
    expect(at, `«${from}» не найдено — сторож ослеп`).toBeGreaterThan(-1)
    const end = code.indexOf(to, at + from.length)
    expect(end, `«${to}» после «${from}» не найдено`).toBeGreaterThan(at)
    return code.slice(at, end)
  }

  /*
   * Разворот на вход клал /play в историю через push — и «Назад» с лендинга
   * возвращал на /play, тот снова получал 401 и снова разворачивал. Гость с
   * квиза не мог уйти «Назад» дальше /play. Запись без сессии мертва — её
   * заменяют, как это делает серверный redirect() у хабов.
   */
  test('разворот на вход заменяет запись /play, а не кладёт её в историю', () => {
    expect(code).not.toMatch(/router\.push\(bounceTo\(/)
    expect(code.split("router.replace(bounceTo('/play', search))").length - 1).toBeGreaterThanOrEqual(2)
  })

  /*
   * Ушёл со страницы, пока модель думала, — ответ всё равно доезжал: pick_shown
   * и долгий pick_wait писались тому, кто карточки не увидел, а поздний 401
   * разворачивал на лендинг человека уже с другой страницы.
   */
  test('выдача, доехавшая после ухода со страницы, не показывается и не считается', () => {
    const reveal = between('async function reveal()', 'async function run()')
    expect(reveal).toMatch(/await fetchPicks\(\{ scope, lean \}, ac\.signal\)\s*if \(ac\.signal\.aborted\) return false/)
    const fetchBody = between('const fetchPicks = useCallback(', 'const applyDeal')
    const left = fetchBody.indexOf('if (signal?.aborted)')
    expect(left).toBeGreaterThan(fetchBody.indexOf('await fetch('))
    expect(left).toBeLessThan(fetchBody.indexOf('res.status === 429'))
    expect(left).toBeLessThan(fetchBody.indexOf('router.replace('))
  })

  /*
   * Первая выдача под догревом не собралась (429, кандидатов пока нет), а
   * догрев шёл дальше. Его конец не видел выдачи, взятой «Попробовать снова»,
   * и подменял её новой под рукой; без неё — показывал выдачу, но плашка
   * «Дочитываю библиотеку» оставалась крутиться навсегда.
   */
  test('конец догрева видит выдачу на экране и гасит плашку перед своей', () => {
    const run = between('async function run()', 'void run()')
    expect(run).toMatch(/const revealed =[^\n]*dealMeta\.current !== null/)
    const tail = run.slice(run.lastIndexOf('if (revealed) {'))
    const own = tail.indexOf('await reveal()')
    const off = tail.indexOf("setWarming('off')", tail.indexOf('return'))
    expect(off, 'плашка гаснет до последней выдачи').toBeGreaterThan(-1)
    expect(off).toBeLessThan(own)
  })

  test('«Попробовать снова»: удача отдаёт фокус герою, неудача звучит', () => {
    const retry = between('const retry = useCallback(', '}, [')
    const applied = retry.indexOf('applyDeal(got)')
    expect(retry.indexOf('focusHero(false)'), 'кнопка уходит вместе с экраном ошибки').toBeGreaterThan(applied)
    const miss = retry.slice(retry.indexOf("if ('miss' in got)"), applied)
    expect(miss).not.toContain('focusHero(')
    expect(miss).toContain('setFailTick(')
  })

  test('сеть оборвалась — срок прежнего 429 к ней не относится', () => {
    const fetchBody = between('const fetchPicks = useCallback(', 'const applyDeal')
    const caught = fetchBody.slice(fetchBody.lastIndexOf('catch {'))
    expect(caught).toContain('setReason(null)')
    expect(caught).toContain('setLimitedFor(null)')
    // Сброс — вместе с причиной, после чтения тела: сброшенный раньше, он на
    // время повтора подменял «Слишком часто» чужим отказом, и экран его объявлял
    const before = fetchBody.slice(fetchBody.indexOf('res.status === 429'), fetchBody.indexOf('if (!res.ok)'))
    expect(before.split('setLimitedFor(').length - 1, 'только сам 429').toBe(1)
    // «Подобрать заново» начинает с чистого листа: отказ прошлой выдачи — не её
    const redeal = between('const redeal = useCallback(', '}, [')
    expect(redeal).toContain('setReason(null)')
    expect(redeal).toContain('setLimitedFor(null)')
  })

  /*
   * Экран ошибки подменяет экран ожидания целиком: строка прогресса уходит с
   * ним, и отказ рисовался молча. 401 — не отказ: страница уходит на вход, и
   * мелькать экраном «не получилось» по дороге незачем.
   */
  test('экран ошибки объявляется, а разворот на вход им не мелькает', () => {
    expect(code).toMatch(/if \(phase !== 'error'\) return\s*say\(playLine\(\{ kind: 'fail'/)
    const reveal = between('async function reveal()', 'async function run()')
    expect(reveal).toMatch(/if \(got\.miss !== 'gone'\) setPhase\('error'\)/)
    expect(code).toMatch(/<h1 ref=\{failHead\} tabIndex=\{-1\}/)
  })

  /*
   * «Обновить выдачу» шла мимо reshape: теряла подталкивание («Покороче»
   * отжималось само), не ждала идущей пересборки и молча пропадала на 429.
   */
  test('«Обновить выдачу» держит подталкивание, ждёт пересборку и говорит об отказе', () => {
    const refresh = between('onRefresh={async () => {', 'onDismiss=')
    expect(refresh).toMatch(/^onRefresh=\{async \(\) => \{\s*if \(switching\) return/)
    expect(refresh).toContain('nudge: keptNudge')
    expect(refresh).toContain('setSwitching(true)')
    expect(refresh).toContain('finally')
    expect(refresh).toContain('setHeroMiss(switchLine(got))')
  })

  // «Скрыть» уходит вместе с плашкой, и фокус без присмотра падал в body
  test('«Скрыть» у плашки догрева отдаёт фокус герою', () => {
    expect(between('onDismiss=', '/>')).toContain('focusHero(true)')
  })

  test('бан применяется к выдаче на экране сейчас, а не к той, что была при клике', () => {
    const ban = between('if (banning) return', 'aria-disabled={banning}')
    expect(ban).toContain('live.current')
    expect(ban).toMatch(/afterBan\(/)
    // ряд «Почему не то?», открытый у забаненной, не переезжает на следующую
    expect(ban).toContain('setAskReason(false)')
  })

  test('«Изменить настроение» не снимает «нераспакованное»', () => {
    expect(code).not.toMatch(/href="\/quiz"|push\('\/quiz'\)/)
    expect(code.split('quizHref(focus)').length - 1).toBeGreaterThanOrEqual(3)
  })

  /*
   * «Как «X», но…» стоит прямо над пилюлями и читалось их началом: «как
   * Factorio, но… покороче». Подталкивания затравку не берут — у ряда своя
   * видимая подпись, и она же его имя.
   */
  test('у подталкиваний своя видимая подпись', () => {
    expect(code).toMatch(/aria-labelledby="play-nudge-label"/)
    expect(code).toMatch(/<span id="play-nudge-label"[^>]*>\s*Подправить выдачу:/)
    expect(code).not.toMatch(/aria-label="Подправить выдачу"/)
  })

  /*
   * На телефоне подсказки title нет, и круг с перечёркнутым глазом рядом с
   * «Не то — дальше» не говорил, что это навсегда. Имя кнопки начинается с
   * видимой подписи (WCAG 2.5.3): голосом её зовут тем, что видно.
   */
  test('«Скрыть насовсем» видно под пальцем, и имя кнопки начинается с этих слов', () => {
    const ban = between('aria-disabled={banning}', '</button>')
    expect(ban).toMatch(/pointer-coarse:inline[^>]*>\s*\{banning \? 'Скрываю…' : 'Скрыть насовсем'\}/)
    const names = ban.match(/'Скры[^']*'/g) ?? []
    expect(names.length).toBeGreaterThanOrEqual(4)
    for (const name of names) expect(name).toMatch(/^'Скры(ть насовсем|ваю)/)
    expect(ban).toContain("'Скрыть насовсем: больше никогда не показывать эту игру'")
  })
})
