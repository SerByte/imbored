import { describe, expect, test } from 'vitest'
import { pickCoverShotSize, pickShotSize, shotUrl } from './shots'

/**
 * Живые ссылки из appdetails, снятые 13.08.2026 (Cyberpunk 2077, appid 1091500).
 * В базе лежит именно path_full, поэтому все исходные строки — 1920×1080.
 */
const FULL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/ss_2f649b68d579bf87011487d29bc4ccbfdd97d34f.1920x1080.jpg?t=1784714077'
const SMALL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/ss_2f649b68d579bf87011487d29bc4ccbfdd97d34f.600x338.jpg?t=1784714077'

describe('shotUrl', () => {
  test('уменьшает полный кадр, сохраняя параметр версии', () => {
    expect(shotUrl(FULL, 'small')).toBe(SMALL)
  })

  test('возвращает полный кадр обратно из маленького', () => {
    expect(shotUrl(SMALL, 'full')).toBe(FULL)
  })

  test('ссылка нужного размера не трогается вовсе', () => {
    expect(shotUrl(FULL, 'full')).toBe(FULL)
    expect(shotUrl(SMALL, 'small')).toBe(SMALL)
  })

  test('работает и без параметра версии', () => {
    const bare = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/ss_abc.1920x1080.jpg'
    expect(shotUrl(bare, 'small')).toBe(
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/ss_abc.600x338.jpg',
    )
  })

  /**
   * Кураторский пул других магазинов: appid отрицательный, а путь к скриншоту
   * какой угодно. Подставлять туда стимовские размеры — гарантированный 404,
   * поэтому такие строки обязаны доезжать нетронутыми.
   */
  test('чужие ссылки возвращаются как есть', () => {
    const gog = 'https://images.gog.com/abc123_product_card_v2_mobile_slider_639.png'
    expect(shotUrl(gog, 'small')).toBe(gog)
    expect(shotUrl(gog, 'full')).toBe(gog)
  })

  test('незнакомый размер не переписывается', () => {
    const odd = 'https://shared.akamai.steamstatic.com/steam/apps/620/ss_abc.1024x576.jpg'
    expect(shotUrl(odd, 'small')).toBe(odd)
  })

  test('размер в другой части пути не считается за размер кадра', () => {
    const tricky = 'https://cdn.example/600x338/cover.jpg'
    expect(shotUrl(tricky, 'full')).toBe(tricky)
  })
})

describe('pickShotSize', () => {
  test('телефон получает маленький кадр даже на ретине', () => {
    expect(pickShotSize(375, 2)).toBe('small')
    expect(pickShotSize(430, 2)).toBe('small')
  })

  test('широкий блок на десктопе получает полный', () => {
    expect(pickShotSize(1024, 1)).toBe('full')
    expect(pickShotSize(768, 2)).toBe('full')
  })

  /** DPR выше двух не запрашивает третий размер: его у Steam просто нет. */
  test('плотность выше двух не учитывается', () => {
    expect(pickShotSize(400, 3)).toBe('small')
  })

  test('нулевая ширина до замера не роняет выбор', () => {
    expect(pickShotSize(0, 2)).toBe('small')
  })
})

describe('pickCoverShotSize', () => {
  /**
   * Ради этого случая функция и появилась. Герой «Игры дня» высотой почти во
   * весь экран режет кадр 16:9 по высоте: в бокс 375×812 картинка вписывается
   * шириной под 1400 CSS-пикселей, из которых видно 375. Судить о размере по
   * ширине бокса здесь нельзя — получится четырёхкратный апскейл на весь экран.
   */
  test('портретный телефон во весь экран просит полный кадр', () => {
    expect(pickCoverShotSize(375, 812, 2)).toBe('full')
    // а старая функция на той же ширине ответила бы иначе — в этом вся разница
    expect(pickShotSize(375, 2)).toBe('small')
  })

  test('десктопный герой просит полный кадр при любой плотности', () => {
    expect(pickCoverShotSize(1440, 830, 1)).toBe('full')
    expect(pickCoverShotSize(1440, 830, 2)).toBe('full')
  })

  /** Функция не выродилась в «всегда full»: низкому широкому окну хватает малого */
  test('низкое широкое окно обходится маленьким кадром', () => {
    expect(pickCoverShotSize(800, 360, 1)).toBe('small')
  })

  /**
   * Когда бокс шире картинки, cover упирается в ширину, и ответ обязан совпасть
   * с обычным выбором — иначе на странице игры и на герое разошлись бы пороги.
   */
  test('на широком боксе совпадает с обычным выбором', () => {
    expect(pickCoverShotSize(880, 200, 1)).toBe(pickShotSize(880, 1))
    expect(pickCoverShotSize(1200, 200, 1)).toBe(pickShotSize(1200, 1))
  })

  test('плотность выше двух не запрашивает третий размер', () => {
    expect(pickCoverShotSize(400, 300, 3)).toBe(pickCoverShotSize(400, 300, 2))
  })

  test('нулевые размеры до первого замера не роняют выбор', () => {
    expect(pickCoverShotSize(0, 0, 2)).toBe('small')
  })
})
