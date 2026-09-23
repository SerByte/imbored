import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  BURNOUT_AFTER_SKIPS,
  FRESH_TURN,
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
      nowSec: 100,
    })
  })

  test('ось — из эха сервера, источник — из запроса', () => {
    const d = dealFrom({ picks: [pick], engine: 'claude', lean: 'fresh', scope: 'library', nowSec: 1 }, 'all')
    expect(d?.lean).toBe('fresh')
    // при фокусе сервер подменяет источник на library, переключателю это эхо не нужно
    expect(d?.scope).toBe('all')
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

/**
 * Сторож одной двери. Новую выдачу на экран кладёт только applyDeal: если
 * какой-то путь снова начнёт раскладывать ответ сам, он снова забудет сбросить
 * половину состояния — ровно то, что здесь чинили.
 */
describe('/play применяет новую выдачу одной функцией', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'play', 'page.tsx'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  test('поля выдачи пишутся в одном месте', () => {
    for (const setter of ['setDiscoveries(', 'setContinueGame(', 'setEngine(', 'setNowSec(', 'setScope(']) {
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
