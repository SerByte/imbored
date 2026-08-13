import { describe, expect, test } from 'vitest'
import { judgeLiveness, needsFullLobby } from './liveness'

const base = { isMultiplayer: false }

describe('judgeLiveness', () => {
  test('нет сигнала — считаем живой', () => {
    // Внешний источник может лежать; фильтр обязан fail-open, иначе
    // падение SteamSpy или чартов опустошает выдачу целиком
    expect(judgeLiveness({ ...base, isMultiplayer: true }).alive).toBe(true)
    expect(judgeLiveness({ ...base, isMultiplayer: true, reviews30d: undefined }).alive).toBe(true)
  })

  test('одиночная игра не гейтится живостью вообще', () => {
    // «Тихая» одиночная игра 2004 года — совершенно валидная рекомендация
    const old = { isMultiplayer: false, reviews30d: 0, reviewsTotal: 5000, releaseYear: 2004 }
    expect(judgeLiveness(old).alive).toBe(true)
  })

  test('мультиплеер с пустыми серверами отсекается', () => {
    const dead = { isMultiplayer: true, reviews30d: 0, reviewsTotal: 4000, reviewsPercent: 80 }
    const verdict = judgeLiveness(dead)
    expect(verdict.alive).toBe(false)
    expect(verdict.reason).toBe('dead-multiplayer')
  })

  test('CS2-подобная игра жива', () => {
    expect(
      judgeLiveness({
        isMultiplayer: true,
        reviews30d: 73_725,
        reviewsTotal: 9_788_173,
        reviewsPercent: 85,
      }).alive,
    ).toBe(true)
  })

  test('игре с обязательным лобби нужен порог выше, чем коопу на двоих', () => {
    // Батл-рояль без толпы не играется, а кооп на двоих — вполне
    const signals = { isMultiplayer: true, reviews30d: 30, reviewsTotal: 50_000 }
    expect(judgeLiveness({ ...signals, needsLobby: true }).alive).toBe(false)
    expect(judgeLiveness({ ...signals, needsLobby: false }).alive).toBe(true)
  })

  test('мусорный хвост каталога отсекается независимо от режима', () => {
    // Сотни тысяч асет-флипов — самый результативный фильтр на большом каталоге
    const flip = { isMultiplayer: false, reviewsTotal: 11, reviews30d: 0 }
    const verdict = judgeLiveness(flip)
    expect(verdict.alive).toBe(false)
    expect(verdict.reason).toBe('asset-flip')
  })

  test('разгромленная игра отсекается только при достаточной выборке', () => {
    const panned = { isMultiplayer: false, reviewsTotal: 900, reviewsPercent: 24 }
    expect(judgeLiveness(panned).reason).toBe('panned')
    // на маленькой выборке процент — шум, не приговор
    expect(judgeLiveness({ isMultiplayer: false, reviewsTotal: 60, reviewsPercent: 24 }).alive).toBe(
      true,
    )
  })

  test('вердикт всегда объясним: есть причина, если игра отсеяна', () => {
    const dead = judgeLiveness({ isMultiplayer: true, reviews30d: 0, reviewsTotal: 9000 })
    expect(dead.reason).not.toBeNull()
    expect(judgeLiveness({ isMultiplayer: true, reviews30d: 5000, reviewsTotal: 9000 }).reason).toBeNull()
  })
})

describe('needsFullLobby', () => {
  test('узнаёт режимы, которым нужна полная катка', () => {
    expect(needsFullLobby({ 'Battle Royale': 900 })).toBe(true)
    expect(needsFullLobby({ MOBA: 500 })).toBe(true)
    expect(needsFullLobby({ 'Team-Based': 300 })).toBe(true)
  })

  test('кооп и песочницы к таким не относятся', () => {
    expect(needsFullLobby({ 'Co-op': 900, Survival: 500 })).toBe(false)
    expect(needsFullLobby({})).toBe(false)
  })
})
