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
import { plural } from './plural'

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

  // План на вечер (lib/eveningplan.ts) — только у пишущей сессии; у старого
  // сервера и при мусоре плана нет, и строка над «Продолжить» не рисуется
  test('план на вечер — из ответа, мусор и его отсутствие — null', () => {
    const plan = { appid: 1145360, name: 'Hades', intent: 'install' }
    expect(dealFrom({ picks: [pick], nowSec: 1, plan }, 'all')?.plan).toEqual(plan)
    for (const bad of [undefined, null, 'Hades', { ...plan, intent: 'details' }]) {
      expect(dealFrom({ picks: [pick], nowSec: 1, plan: bad }, 'all')?.plan, JSON.stringify(bad)).toBeNull()
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

  // «Только моё» или «Покороче» у того, чьё своё — сплошь хорроры, а хорроры
  // он сам запретил (lib/mutetags.ts): «не получилось переключить» звучало бы
  // сбоем, а повтор вернёт тот же отказ
  test('всё под «Не предлагать» — тоже не сбой', () => {
    expect(switchLine({ miss: 'failed', code: 'muted' })).toBe('Под это ничего не нашлось, выдача прежняя')
  })

  test('сессия кончилась — молчим: страница уже уходит на вход', () => {
    expect(switchLine({ miss: 'gone' })).toBeNull()
  })

  test('по-английски — тот же срок и та же честность про выдачу', () => {
    expect(switchLine({ miss: 'limited', waitSec: 60 }, 'en')).toBe('Too many tries — try again in 1 minute')
    expect(switchLine({ miss: 'limited', waitSec: 150 }, 'en')).toBe('Too many tries — try again in 3 minutes')
    expect(switchLine({ miss: 'limited', waitSec: 7 }, 'en')).toBe('Too many tries — try again in 1 minute')
    expect(switchLine({ miss: 'limited', waitSec: null }, 'en')).toBe('Too many tries — try again a bit later')
    expect(switchLine({ miss: 'failed', code: null }, 'en')).toBe("Couldn't switch — your picks are unchanged")
    expect(switchLine({ miss: 'failed', code: 'nocandidates' }, 'en')).toBe('Nothing fits that — your picks are unchanged')
    expect(switchLine({ miss: 'failed', code: 'muted' }, 'en')).toBe('Nothing fits that — your picks are unchanged')
    expect(switchLine({ miss: 'gone' }, 'en')).toBeNull()
    for (const m of [
      { miss: 'limited', waitSec: 600 },
      { miss: 'limited', waitSec: null },
      { miss: 'failed', code: 'x' },
    ] as const) {
      expect(switchLine(m, 'en'), JSON.stringify(m)).not.toMatch(/[А-Яа-яЁё]/)
    }
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

  // «Можно просто продолжить… а можно просто закрыть Steam» над кнопкой
  // «Просто продолжить «Dota 2»» — одно слово трижды подряд
  test('«просто» в абзаце не больше одного раза', () => {
    for (const o of ['familiar', 'continue', 'cozy', null] as const) {
      expect(burnoutInvite(o).match(/просто/gi) ?? [], String(o)).toHaveLength(1)
    }
  })

  // Те же три правила по-английски: зовёт туда же, куда кнопка; выход
  // «закрыть Steam» есть всегда; одно just на абзац
  test('по-английски — целые фразы по тем же правилам', () => {
    expect(burnoutInvite('cozy', 'en')).toBe(
      "You could spend 20 minutes in something cozy… or just close Steam, and that's a win too.",
    )
    expect(burnoutInvite('continue', 'en')).toBe(
      "You could keep playing what you're into right now… or just close Steam, and that's a win too.",
    )
    expect(burnoutInvite('familiar', 'en')).toBe(
      "You could slip back into something familiar for a bit… or just close Steam, and that's a win too.",
    )
    expect(burnoutInvite(null, 'en')).toBe("You could just close Steam, and that's a win too.")
    for (const o of ['familiar', 'continue', null] as const) {
      expect(burnoutInvite(o, 'en'), String(o)).not.toMatch(/cozy|20 minutes/)
    }
    for (const o of ['familiar', 'continue', 'cozy', null] as const) {
      const line = burnoutInvite(o, 'en')
      expect(line, String(o)).toMatch(/close Steam, and that's a win too\.$/)
      expect(line.match(/\bjust\b/gi) ?? [], String(o)).toHaveLength(1)
      expect(line, String(o)).not.toMatch(/[А-Яа-яЁё]/)
    }
  })
})

/**
 * Сторож одной двери. Новую выдачу на экран кладёт только applyDeal: если
 * какой-то путь снова начнёт раскладывать ответ сам, он снова забудет сбросить
 * половину состояния — ровно то, что здесь чинили.
 */
describe('/play применяет новую выдачу одной функцией', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', '[lang]', 'play', 'page.tsx'), 'utf8')
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
    // Окно — с запасом на проверки между ответом и выдачей (уход со страницы,
    // «Подобрать заново» за время запроса, разбор отказа)
    for (const { i } of calls) {
      expect(lines.slice(i, i + 14).join('\n'), `app/[lang]/play/page.tsx:${i + 1}`).toContain('applyDeal(')
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
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', '[lang]', 'play', 'page.tsx'), 'utf8')
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
    // seed — затравка с адреса (/play?…&seed=): первая выдача уходит с ней
    expect(reveal).toMatch(
      /await fetchPicks\(\{ scope, lean, seed: askSeed \}, ac\.signal\)\s*if \(ac\.signal\.aborted\) return false/,
    )
    const fetchBody = between('const fetchPicks = useCallback(', 'const applyDeal')
    const left = fetchBody.indexOf('if (signal?.aborted)')
    expect(left).toBeGreaterThan(fetchBody.indexOf('await fetch('))
    expect(left).toBeLessThan(fetchBody.indexOf('res.status === 429'))
    expect(left).toBeLessThan(fetchBody.indexOf('router.replace('))
    // Проверка сигнала стоит до await тела, а разворот шёл после него: уход,
    // пока читалось тело отказа, всё равно уводил на вход с чужой страницы
    const failed = fetchBody.slice(fetchBody.indexOf('if (!res.ok)'))
    expect(failed.indexOf('res.status === 401'), '401 — до чтения тела').toBeGreaterThan(-1)
    expect(failed.indexOf('res.status === 401')).toBeLessThan(failed.indexOf('.json()'))
    // и причина отказа, прочитанная после ухода, никуда не пишется
    const read = failed.slice(failed.indexOf('.json()'))
    expect(read.indexOf('if (signal?.aborted)'), 'сигнал после тела отказа').toBeGreaterThan(-1)
    expect(read.indexOf('if (signal?.aborted)')).toBeLessThan(read.indexOf('setReason('))
  })

  /*
   * Первая выдача под догревом не собралась (429, кандидатов пока нет), а
   * догрев шёл дальше. Его конец не видел выдачи, взятой «Попробовать снова»,
   * и подменял её новой под рукой; без неё — показывал выдачу, но плашка
   * «Дочитываю библиотеку» оставалась крутиться навсегда.
   */
  test('конец догрева видит выдачу на экране и гасит плашку перед своей', () => {
    const run = between('async function run()', 'void run()')
    const revealed = run.slice(run.indexOf('const revealed ='), run.indexOf('if (ac.signal.aborted)', run.indexOf('const revealed =')))
    expect(revealed).toContain('dealMeta.current !== null')
    /*
     * dealMeta — «applyDeal был», а не «выдача видна». Ответ пересборки,
     * доехавший на экран ожидания после «Подобрать заново», ставил его, не
     * трогая фазы, и догрев, кончившийся без onYield, выходил с экраном
     * ожидания навсегда. Одного dealMeta мало — нужна и фаза.
     */
    expect(revealed).toMatch(/\(dealMeta\.current !== null && live\.current\.phase !== 'prepare'\)/)
    expect(revealed.split('dealMeta.current').length - 1, 'dealMeta нигде не стоит один').toBe(1)
    const tail = run.slice(run.lastIndexOf('if (revealed) {'))
    const own = tail.indexOf('await reveal()')
    const off = tail.indexOf("setWarming('off')", tail.indexOf('return'))
    expect(off, 'плашка гаснет до последней выдачи').toBeGreaterThan(-1)
    expect(off).toBeLessThan(own)
  })

  /*
   * Пересборка или «Обновить выдачу» на выдаче с прошлого захода, и, пока шёл
   * запрос, — «Подобрать заново». Ответ доезжал на экран ожидания и клал туда
   * выдачу, от которой отказались, а отказ — строку под героем и плашку
   * «Обновить» нового захода.
   */
  test('ответ, начатый до «Подобрать заново», после него не применяется', () => {
    const redeal = between('const redeal = useCallback(', '}, [')
    expect(redeal).toMatch(/roundNow\.current \+= 1\s*setRound\(roundNow\.current\)/)
    expect(code.split('setRound(').length - 1, 'номер захода растёт только в redeal').toBe(1)
    for (const [from, to] of [
      ['const reshape = useCallback(', 'const nudgeTo'],
      ['onRefresh={async () => {', 'onDismiss='],
    ]) {
      const body = between(from, to)
      const asked = body.indexOf('= roundNow.current')
      const sent = body.indexOf('await fetchPicks(')
      const stale = body.indexOf('if (roundNow.current !== ')
      expect(asked, `${from}: номер захода берётся до запроса`).toBeGreaterThan(-1)
      expect(asked).toBeLessThan(sent)
      expect(stale, `${from}: и сверяется после`).toBeGreaterThan(sent)
      expect(stale).toBeLessThan(body.indexOf("if ('miss' in got)"))
      expect(stale).toBeLessThan(body.indexOf('applyDeal('))
    }
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
    expect(refresh).toContain('setHeroMiss(switchLine(got, locale))')
  })

  /*
   * Плашка догрева живёт над героем и жмётся и при открытом «Почему не то?», а
   * строка отказа стояла в ветке «иначе» этого ряда — размонтированная. 429
   * «Обновить выдачу» не звучал и не был виден, а потом молча всплывал.
   */
  test('строка отказа под героем стоит и при открытом ряде причин', () => {
    expect(code.split('<StatusLine text={heroMiss}').length - 1).toBe(1)
    // сразу за концом тернарника askReason, а не внутри его ветки
    // ({} — след вырезанного JSX-комментария над строкой)
    expect(code).toMatch(/<\/>\s*\)\}\s*(?:\{\}\s*)?<StatusLine text=\{heroMiss\}[^>]*\/>\s*<\/div>/)
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

  /*
   * Пятый пропуск за время запроса открывает экран выгорания, не трогая
   * индекса, а «Подобрать заново» — экран ожидания со старой пятёркой в
   * состоянии. Герой по индексу — всё ещё забаненная, но его не видно: «больше
   * не покажу, следующая игра: …» назвало бы карточку, которой на экране нет.
   */
  test('бан, доехавший без героя на экране, только убирает игру из выдачи', () => {
    expect(code).toMatch(/useRef\(\{ picks, index, phase \}\)/)
    expect(code).toMatch(/live\.current = \{ picks, index, phase \}/)
    const ban = between('if (banning) return', 'aria-disabled={banning}')
    expect(ban, 'фаза читается свежей, а не из замыкания клика').toContain('const now = live.current')
    const gate = ban.indexOf("now.phase !== 'reveal'")
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(ban.indexOf('next: after.picks'))
    expect(gate).toBeLessThan(ban.indexOf('focusHero(false)'))
  })

  /*
   * Тихие выходы обработчика бана — «герой уже другой» и «героя не видно» —
   * не говорили ничего, и скринридер так и не слышал, что необратимое
   * действие записано. А пустой остаток выдачи уводил в квиз и с экрана
   * ожидания после «Подобрать заново» — бросая новую выдачу, которую
   * человек только что попросил.
   */
  test('бан звучит и без героя на виду, а с экрана ожидания в квиз не уводит', () => {
    const ban = between('if (banning) return', 'aria-disabled={banning}')
    const tail = ban.slice(ban.indexOf('rememberBan('))
    expect(tail).toContain("const told = playLine({ kind: 'ban', name: pick.name, done: finished })")
    expect(tail).not.toMatch(/if \(!after\.heroGone\) return|phase !== 'reveal'\) return/)
    const quiet = tail.slice(tail.indexOf("if (!after.heroGone || now.phase !== 'reveal') {"))
    expect(quiet).toMatch(/^if \(!after\.heroGone \|\| now\.phase !== 'reveal'\) \{\s*say\(told\)\s*return/)
    const empty = tail.slice(tail.indexOf('if (after.empty)'), tail.indexOf('setPicks('))
    expect(empty).toMatch(
      /if \(now\.phase === 'prepare' \|\| now\.phase === 'error'\) say\(told\)\s*else router\.push\(quizHref\(focus\)\)/,
    )
  })

  test('«Изменить настроение» не снимает «нераспакованное»', () => {
    expect(code).not.toMatch(/href="\/quiz"|push\('\/quiz'\)/)
    // Вторым аргументом может ехать затравка «Как «X», но…» — фокус от этого
    // не перестаёт быть первым
    expect(code.match(/quizHref\(focus\b/g) ?? []).toHaveLength(3)
  })

  /*
   * «Уже прошёл» у строки «Продолжить»: тот же бан с причиной done, что у
   * героя, с её слотом в снимке, — только у игры с финалом и не сессии по
   * ссылке. Отмеченная зовёт дальше в духе себя тем же reshape, что «Как
   * «X», но…», и фокус уносит на героя, если выдача встала.
   */
  test('«Уже прошёл» у «Продолжить»: бан done со слотом continue и дорога дальше', () => {
    expect(code).toMatch(/\{cont\.finishable && !readOnly && \(\s*<button\b/)
    const fin = code.slice(code.indexOf('const finishCont = async'), code.indexOf("say(playLine({ kind: 'ban', name: c.name, done: true }))"))
    expect(fin).toContain("await sendFeedback(c.appid, 'banned', 'done', ctxOf(null, 'continue'))")
    expect(fin).toContain('rememberBan(c.appid, Date.now())')
    expect(code).toMatch(
      /const was = pick\.appid\s*const hero = await reshape\(\{ scope, lean, seed: cont\.appid, nudge: keptNudge \}, 'hero'\)\s*if \(hero !== null\) focusHero\(hero === was\)/,
    )
    // экран выгорания не зовёт продолжить только что пройденное
    expect(code).toContain('cont: !!cont && cont.appid !== contDone')
  })

  /*
   * «Как «X», но…», «Вернуть обычную выдачу» и пилюли подталкиваний стоят в
   * секции героя, а она ключом appid перемонтируется с каждым новым героем
   * (AnimatePresence mode="wait"). Выдача встала с другим героем — нажатая
   * кнопка ушла вместе со старым, и фокус падал в body: замер клавиатурой —
   * activeElement BODY после «Как «Muck», но…», «Покороче», «Что-то другое».
   * Поэтому каждый reshape(…, 'hero') ждёт appid героя и уносит фокус сам,
   * как «Дальше — в духе X». Кнопка, пережившая выдачу (герой тот же), фокус
   * держит: взведённый зря флаг отнял бы его у героя когда-нибудь потом.
   */
  test('кнопки в секции героя уносят фокус на нового героя, а не роняют в body', () => {
    const calls = [...code.matchAll(/reshape\(\s*\{[^}]*\},\s*'hero',?\s*\)/g)]
    // «Как X», «Вернуть обычную выдачу», nudgeTo и «Дальше — в духе X»
    expect(calls).toHaveLength(4)
    for (const c of calls) {
      const at = c.index ?? 0
      expect(code.slice(at - 40, at), c[0]).toMatch(/const hero = await $/)
      expect(code.slice(at + c[0].length, at + c[0].length + 80), c[0]).toMatch(
        /^\s*if \(hero !== null(?: && hero !== was)?\) focusHero\(/,
      )
    }
    // «Как X»: затравка — сам герой, а он в своих соседях не бывает; тот же
    // герой — кнопка на месте
    expect(code).toMatch(
      /const was = pick\.appid\s*const hero = await reshape\(\{ scope, lean, seed: pick\.appid, nudge: keptNudge \}, 'hero'\)\s*if \(hero !== null && hero !== was\) focusHero\(false\)/,
    )
    // «Вернуть обычную выдачу» уходит при любой удаче — затравки больше нет,
    // и при том же герое фокус встаёт на его заголовок сразу
    expect(code).toMatch(
      /const was = pick\.appid\s*const hero = await reshape\(\{ scope, lean, seed: null, nudge: keptNudge \}, 'hero'\)\s*if \(hero !== null\) focusHero\(hero === was\)/,
    )
    // подталкивание: герой передаётся с места нажатия — pick объявлен ниже
    expect(code).toMatch(/const nudgeTo = async \(n: Nudge, was: number\) => \{/)
    expect(between('const nudgeTo', 'const advance')).toMatch(/if \(hero !== null && hero !== was\) focusHero\(false\)\s*\}\s*$/)
    expect(code).toMatch(/onClick=\{\(\) => void nudgeTo\(n, pick\.appid\)\}/)
  })

  /*
   * Пройденная «Продолжить» бывает затравкой выдачи на экране: pickContinue
   * затравку не исключает, а в соседи она не идёт — «Ещё в этом духе» у
   * доигрываемой игры приводит ровно сюда. «Дальше — в духе X» звал бы тот
   * же запрос, reshape отбрасывал бы его как «то же самое», и кнопка молча
   * не делала бы ничего. Её нет — фокус с ушедшей «Уже прошёл» забирает
   * строка «пройдена».
   */
  test('«Дальше — в духе X» не стоит у выдачи, уже собранной в духе X', () => {
    const done = code.slice(code.indexOf('{contDone === cont.appid ? ('), code.indexOf('Дальше — в духе «{cont.name}»'))
    expect(done).toMatch(/ref=\{cont\.appid === seedAppid \? contFocus : undefined\}\s*tabIndex=\{cont\.appid === seedAppid \? -1 : undefined\}/)
    expect(done).toMatch(/\{cont\.appid !== seedAppid && \(\s*<button\s+ref=\{contFocus\}/)
  })

  /*
   * Фокус на строку «пройдена» — по нажатию, а не при каждом монтировании:
   * панель уходит с экраном выгорания и возвращается тем же коммитом, что и
   * заголовок героя, и ref-колбэк ниже по дереву отнимал бы фокус у героя.
   * Флаг ставит только удачная отметка, а любое «фокус герою» его снимает.
   */
  test('строка «пройдена» берёт фокус разово, и герой его перебивает', () => {
    expect(code).not.toMatch(/ref=\{focusOnMount\}[^>]*>\s*Дальше — в духе/)
    const fin = code.slice(code.indexOf('const finishCont = async'), code.indexOf('const contFocus = useCallback('))
    const ok = fin.indexOf('rememberBan(c.appid')
    expect(ok).toBeGreaterThan(-1)
    expect(fin.indexOf('wantContFocus.current = true')).toBeGreaterThan(ok)
    expect(code).toMatch(
      /const contFocus = useCallback\(\(el: HTMLElement \| null\) => \{\s*if \(!el \|\| !wantContFocus\.current\) return\s*wantContFocus\.current = false/,
    )
    expect(code).toMatch(/const focusHero = useCallback\(\(sameHero: boolean\) => \{\s*wantContFocus\.current = false/)
  })

  /*
   * Отказ «Уже прошёл» у «Продолжить» и отказ бана героя — разные строки:
   * общий banFailed гасил чужую, и «не получилось убрать насовсем» у героя
   * молча пропадало от нажатия в панели, хотя тот бан так и не записан.
   */
  test('отказ «Уже прошёл» у «Продолжить» — своя строка, а не banFailed героя', () => {
    const fin = code.slice(code.indexOf('const finishCont = async'), code.indexOf('const contFocus = useCallback('))
    expect(fin).not.toContain('setBanFailed')
    expect(fin).toContain('setContFailed(c.appid)')
    expect(code).toContain('text={contFailed === cont.appid ? DONE_MISS(cont.name, locale) : null}')
  })

  /*
   * Две «Уже прошёл» на одном экране: у героя (заброшенного или знакомого) и
   * у строки «Продолжить» — другой игры, pickContinue героя не повторяет.
   * В списке кнопок скринридер читал два одинаковых имени, а у панели
   * «Продолжить» своего заголовка нет — по заголовкам её кнопка стоит под h1
   * героя. Нажимали её, думая, что отмечают героя, и навсегда отмечали
   * другую игру; отказ «Не получилось отметить игру пройденной» тоже не
   * говорил, какую. Игра — в имени (sr-only после видимых слов, WCAG 2.5.3)
   * и в отказе: тот же приём, что у components/MarkFinished.
   */
  test('обе «Уже прошёл» называют свою игру — и в имени кнопки, и в отказе', () => {
    // Отказ — парой на язык страницы (tr), слова — те же, что у MarkFinished
    expect(code).toMatch(
      /const DONE_MISS = \(name: string, locale: Locale\) =>\s*tr\(locale, \{\s*ru: `Не получилось отметить «\$\{name\}» пройденной — нажми ещё раз\.`,\s*en: `Couldn't mark “\$\{name\}” as finished — try again\.`,/,
    )
    expect(code).toContain('Уже прошёл<span className="sr-only"> «{pick.name}»</span>')
    expect(code).toContain('Уже прошёл<span className="sr-only"> «{cont.name}»</span>')
    expect(code).toContain('Already finished<span className="sr-only"> “{pick.name}”</span>')
    expect(code).toContain('Already finished<span className="sr-only"> “{cont.name}”</span>')
    // голой подписи без игры не осталось ни у одной
    expect(code).not.toContain("'Уже прошёл'")
    expect(code).not.toContain("'Already finished'")
    expect(code).toMatch(/banFailed !== pick\.appid\s*\? null\s*: finished\s*\? DONE_MISS\(pick\.name, locale\)/)
  })

  /*
   * «Подобрать заново» — новый заход за тем, что на экране: источник и ось
   * он берёт из восстановленной записи, и затравка обязана ехать с ними, а
   * не из адреса. Иначе снятые «похожие на X» возвращались, а выбранные на
   * выдаче пропадали (playCacheKey: переключённое живёт в записи).
   */
  test('«Подобрать заново» берёт затравку выдачи на экране, а не адреса', () => {
    const redeal = between('const redeal = useCallback(', 'const [retrying, setRetrying]')
    const set = redeal.indexOf('setAskSeed(roulette || focus ? null : (seed?.appid ?? null))')
    expect(set).toBeGreaterThan(-1)
    expect(set).toBeLessThan(redeal.indexOf('setRound(roundNow.current)'))
  })

  /*
   * «Похожие на X» переживают смену настроения: «Изменить настроение» у
   * выдачи из соседей и на экране отказа везёт затравку в квиз. На экране
   * отказа — ту, что спрошена адресом (выдачи с эхом там нет), на выдаче —
   * ту, под которую она собрана.
   */
  test('«Изменить настроение» везёт затравку туда, где она есть', () => {
    expect(code).toContain('quizHref(focus, askSeed)')
    expect(code).toContain('quizHref(focus, seedAppid)')
  })

  /*
   * Причастие склоняется вместе с числом: «Ещё 1 вариант, похожих на
   * «Hades»» — у нишевой игры пул соседей под настроение бывает из двух
   * карточек, а в такую выдачу теперь приходят и адресом (страница игры,
   * «Ещё в этом духе», «Дальше — в духе X»).
   */
  test('«Не то? Ещё N …, похожих на X» согласует причастие с числом', () => {
    const forms = ["'вариант, похожий'", "'варианта, похожих'", "'вариантов, похожих'"] as const
    expect(code).toContain(`plural(others.length, ${forms.join(', ')})} на «\${seed.name}»`)
    expect(code).not.toMatch(/'вариантов'\)\}, похожих/)
    const [one, few, many] = forms.map((f) => f.slice(1, -1))
    expect([1, 2, 5, 21].map((n) => `${n} ${plural(n, one, few, many)}`)).toEqual([
      '1 вариант, похожий',
      '2 варианта, похожих',
      '5 вариантов, похожих',
      '21 вариант, похожий',
    ])
  })

  /*
   * «Как «X», но…» стоит прямо над пилюлями и читалось их началом: «как
   * Factorio, но… покороче». Подталкивания затравку не берут — у ряда своя
   * видимая подпись, и она же его имя.
   */
  test('у подталкиваний своя видимая подпись', () => {
    expect(code).toMatch(/aria-labelledby="play-nudge-label"/)
    expect(code).toMatch(/<span id="play-nudge-label"[^>]*>\s*\{tr\(locale, \{ ru: 'Подправить выдачу:', en: 'Tweak picks:' \}\)\}/)
    expect(code).not.toMatch(/aria-label="Подправить выдачу"/)
  })

  /*
   * На телефоне подсказки title нет, и круг с перечёркнутым глазом рядом с
   * «Не то — дальше» не говорил, что это навсегда. Имя кнопки начинается с
   * видимой подписи (WCAG 2.5.3): голосом её зовут тем, что видно.
   */
  test('«Скрыть насовсем» видно под пальцем, и имя кнопки начинается с этих слов', () => {
    const ban = between('aria-disabled={banning}', '</button>')
    // Подписи — парами на язык страницы (tr), и у английской то же правило
    expect(ban).toMatch(
      /pointer-coarse:inline[^>]*>\s*\{banning\s*\? tr\(locale, \{ ru: 'Скрываю…', en: 'Hiding…' \}\)\s*: tr\(locale, \{ ru: 'Скрыть насовсем', en: 'Hide for good' \}\)\}/,
    )
    const names = ban.match(/'Скры[^']*'/g) ?? []
    expect(names.length).toBeGreaterThanOrEqual(4)
    for (const name of names) expect(name).toMatch(/^'Скры(ть насовсем|ваю)/)
    expect(ban).toContain("'Скрыть насовсем: больше никогда не показывать эту игру'")
    const namesEn = ban.match(/en: 'Hid[^']*'/g) ?? []
    expect(namesEn.length).toBeGreaterThanOrEqual(4)
    for (const name of namesEn) expect(name).toMatch(/^en: 'Hid(e for good|ing)/)
  })

  /*
   * С md ряд героя стоял в одну линию шириной в своё содержимое, а секция
   * героя режет всё, что вылезло (overflow-hidden). Замер на планшете: в 768px
   * у игры из магазина со скидкой за край уходили «Подробнее», «Зашло»,
   * «Отправить» и бан, в 820px — пилюля «Скрыть насовсем». Ряд шире своей
   * колонки — можно, шире экрана — нельзя: там он переносится, как на телефоне.
   */
  test('ряд кнопок героя не уходит за край экрана', () => {
    const row = code.match(/className="([^"]*)"\s*>\s*\{pick\.source === 'new' \|\| pick\.storeUrl/)
    expect(row, 'ряд кнопок героя не найден — сторож ослеп').not.toBeNull()
    const cls = row![1].split(/\s+/)
    expect(cls).toContain('flex-wrap')
    expect(cls).not.toContain('md:flex-nowrap')
    const cap = cls.find((c) => /^md:max-w-\[calc\(100vw-/.test(c))
    expect(cap, 'потолок — ширина экрана без полей').toBeDefined()
    /*
     * Поля — те же, что у контейнера героя (px-safe), а не 2 × 1.25rem: iPhone
     * в ландшафте шире md, вырез даёт полю ~47px, и потолок 100vw − 2.5rem
     * пускал ряд на 7px за край экрана (на Pro Max — на 19px). Сверяем с самой
     * утилитой: поменяют поле — потолок обязан пойти за ним.
     */
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8')
    const safe = css.match(/@utility px-safe \{([^}]*)\}/)
    expect(safe, '@utility px-safe не найдена — сторож ослеп').not.toBeNull()
    const gutters = [...safe![1].matchAll(/padding-(?:left|right):\s*([^;]+);/g)].map((m) => m[1].replace(/\s+/g, ''))
    expect(gutters).toHaveLength(2)
    for (const g of gutters) expect(cap, g).toContain(`-${g}`)
  })
})
