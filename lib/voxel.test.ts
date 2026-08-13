import { describe, expect, it } from 'vitest'
import { DEMO_METAS } from './demo'
import { OTHER_STORE_GAMES } from './otherstores'
import { isVoxelGame, VOXEL_APPIDS, VOXEL_TAG } from './voxel'

const TEARDOWN = 1167630

function meta(appid: number, tags: Record<string, number>) {
  return { appid, tags }
}

describe('isVoxelGame', () => {
  it('находит тег, даже если он зарыт в конец списка', () => {
    // Ради этого случая признак и считается на сервере: до клиента доезжают
    // только четыре тега с наибольшим весом, а Voxel там бывает редко.
    const buried = meta(1, {
      Survival: 900, Crafting: 850, Multiplayer: 800, 'Open World': 780,
      Adventure: 700, Building: 650, Exploration: 600, Sandbox: 550,
      Indie: 500, Action: 450, 'Co-op': 400, [VOXEL_TAG]: 120,
    })
    expect(Object.keys(buried.tags).indexOf(VOXEL_TAG)).toBeGreaterThan(3)
    expect(isVoxelGame(buried)).toBe(true)
  })

  it('берёт игру из кураторского списка даже без тега', () => {
    expect(isVoxelGame(meta(-111, { Sandbox: 5400, Crafting: 4800 }))).toBe(true)
  })

  it('не срабатывает на играх про стройку — они не кубические', () => {
    // Настоящие теги Terraria: песочница и стройка, но игра двумерная
    const terraria = meta(105600, {
      'Open World Survival Craft': 906, Sandbox: 890, Survival: 713, '2D': 706,
      Multiplayer: 705, 'Pixel Graphics': 645, Crafting: 587, Building: 562,
    })
    expect(isVoxelGame(terraria)).toBe(false)

    const factorio = meta(427520, {
      Automation: 900, 'Base Building': 850, Strategy: 800, Sandbox: 700,
    })
    expect(isVoxelGame(factorio)).toBe(false)
  })

  it('пиксельная графика — не воксель', () => {
    expect(isVoxelGame(meta(2, { 'Pixel Graphics': 900, Platformer: 800 }))).toBe(false)
  })

  it('регистр важен: детект строгий', () => {
    expect(isVoxelGame(meta(3, { voxel: 900 }))).toBe(false)
    expect(isVoxelGame(meta(4, { VOXEL: 900 }))).toBe(false)
  })

  it('переживает отсутствие меты и пустые теги', () => {
    expect(isVoxelGame(undefined)).toBe(false)
    expect(isVoxelGame(null)).toBe(false)
    expect(isVoxelGame(meta(5, {}))).toBe(false)
  })
})

describe('целостность данных', () => {
  it('каждый appid из кураторского списка существует', () => {
    // Опечатка в списке иначе невидима навсегда: игра просто никогда не совпадёт
    const known = new Set([
      ...OTHER_STORE_GAMES.map((g) => g.appid),
      ...DEMO_METAS.map((g) => g.appid),
    ])
    for (const appid of VOXEL_APPIDS) {
      expect(known.has(appid), `appid ${appid} из VOXEL_APPIDS не найден`).toBe(true)
    }
  })

  it('в демо есть воксельная игра — иначе эффект недостижим без Steam', () => {
    const teardown = DEMO_METAS.find((m) => m.appid === TEARDOWN)
    expect(teardown, 'Teardown пропал из демо-данных').toBeDefined()
    expect(isVoxelGame(teardown)).toBe(true)
    // и именно через тег, а не через кураторскую лазейку
    expect(VOXEL_APPIDS.has(TEARDOWN)).toBe(false)
  })
})
