import { describe, expect, test } from 'vitest'
import { PATCH_SINCE_LEAD } from './comeback'
import { patchSentence } from './llm'
import {
  cleanReason,
  parseSharePickBody,
  pickCopy,
  pickShareUrl,
  quoted,
  shareText,
  SHARED_REASON_MAX,
} from './sharedpick'

describe('shareText', () => {
  const reason = '«Hades» в твоей библиотеке нет, но теги твои.'
  const tail = ' Сейчас −40%: $14.99 — до 17 августа.'

  test('ценовой хвост отрезается: страница живёт месяц, скидка — нет', () => {
    expect(shareText(reason + tail, tail)).toBe(reason)
  })

  test('хвост не в конце или пустой — текст без него как есть', () => {
    expect(shareText(reason, tail)).toBe(reason)
    expect(shareText(reason, '')).toBe(reason)
  })

  test('о деньгах словами модели — предложение выпадает, остальное на месте', () => {
    const model =
      '«Hades» — рогалик, где каждая смерть двигает сюжет. Это покупка: $24.99, сейчас со скидкой −40%. Зайдёт на часовые заходы.'
    expect(shareText(model, '')).toBe('«Hades» — рогалик, где каждая смерть двигает сюжет. Зайдёт на часовые заходы.')
    for (const money of [
      'Стоит 499 ₽.',
      'Сейчас дешевле обычного.',
      'Она бесплатная.',
      'Цена кусается, но оно того стоит.',
      'Идёт распродажа.',
      'Скидка — до пятницы.',
    ]) {
      expect(shareText(`Первое. ${money} Последнее.`, ''), money).toBe('Первое. Последнее.')
    }
  })

  test('не про деньги — не трогаем: проценты отзывов, «ценит», «стоит попробовать»', () => {
    for (const keep of [
      '92% отзывов — положительные.',
      'Её ценят за атмосферу.',
      'Стоит попробовать хотя бы час.',
      'Кооператив на 2-4 игроков.',
    ]) {
      expect(shareText(keep, ''), keep).toBe(keep)
    }
  })

  test('всё объяснение про цену — пустая строка: делиться нечем', () => {
    expect(shareText('Сейчас −40%: $14.99 вместо $24.99.', '')).toBe('')
  })

  test('суммы знаком после числа — так их пишет formatPrice — тоже вырезаются', () => {
    for (const money of [
      'В Steam — 1\u00a0999\u00a0₽.',
      'В Steam — 59,99\u00a0$.',
      'Всего 4\u00a0499\u00a0₸.',
      'Сейчас 1\u00a0399\u00a0₽ вместо 1\u00a0999\u00a0₽.',
    ]) {
      expect(shareText(`Первое. ${money} Последнее.`, ''), money).toBe('Первое. Последнее.')
    }
    // Хвост шаблона в рублях отрезается целиком, как и в долларах
    const tail = ' Сейчас −30%: 1\u00a0399\u00a0₽ вместо 1\u00a0999\u00a0₽.'
    expect(shareText('Тебе зайдёт.' + tail, tail)).toBe('Тебе зайдёт.')
  })
})

/**
 * Факт о патче в «Отправить другу». «С твоего последнего захода вышло крупное
 * обновление» на публичной /pick читает получатель — и принимает на свой счёт,
 * а сам факт выдаёт дату последнего запуска отправителя (lib/comeback.ts).
 * Фраза собирается тем же patchSentence, что пишет её в причину.
 */
describe('shareText: факт о патче не уходит по ссылке', () => {
  const known = 'У тебя в «Hades» уже 40 ч.'
  const recall = 'Первые минут десять уйдут на то, чтобы вспомнить управление, — это нормально.'

  test('предложение с фактом выпадает, часы и «вспомнить управление» на месте', () => {
    const tldr = 'Добавили новый биом и переделали бои'
    const reason = `${known} ${patchSentence(tldr)} ${recall}`
    expect(reason).toContain(PATCH_SINCE_LEAD)
    expect(shareText(reason, '', tldr)).toBe(`${known} ${recall}`)
    // и без пересказа под рукой — само предложение с началом факта
    expect(shareText(reason, '')).toBe(`${known} ${recall}`)
  })

  test('пересказ в несколько предложений — уходит целиком, и обрезанный «…» тоже', () => {
    const tldr = 'Добавили новый биом. Переделали бои и прокачку. Вернули кооператив на четверых игроков.'
    const whole = `${known} ${patchSentence(tldr)} ${recall}`
    expect(shareText(whole, '', tldr)).toBe(`${known} ${recall}`)
    const cut = patchSentence(tldr, 120)!
    expect(cut.endsWith('…') || cut.endsWith('.')).toBe(true)
    expect(shareText(`${known} ${cut}`, '', tldr)).toBe(known)
  })

  test('обновление с именем («1.5: …») — точка в версии предложение не рвёт', () => {
    const tldr = 'Обновление 1.5: новый биом и два босса'
    const reason = `${known} ${patchSentence(tldr)}`
    expect(reason).toContain(`${PATCH_SINCE_LEAD} 1.5:`)
    expect(shareText(reason, '', tldr)).toBe(known)
  })

  test('факт в середине текста модели — выпадает только он; чужое предложение следом остаётся', () => {
    const tldr = 'Новые карты'
    const model = `«Hades» стоит открыть снова. ${PATCH_SINCE_LEAD}: новые карты. Зайдёт на вечер.`
    expect(shareText(model, '', tldr)).toBe('«Hades» стоит открыть снова. Зайдёт на вечер.')
  })

  test('модель вписала факт в середину своей фразы или строчными — выпадает и так', () => {
    // Промпт claudePicks даёт факт строкой «с его последнего захода вышло…»,
    // и модель вольна пересказать его где угодно в предложении
    const tldr = 'Новые карты'
    for (const fact of [
      'Вернись в «Hades»: с твоего последнего захода вышло крупное обновление — новые карты.',
      'Вернись в «Hades», ведь с его последнего захода вышло крупное обновление.',
      'с твоего последнего захода вышел большой патч с картами.',
      'Кстати, С ТВОЕГО ПОСЛЕДНЕГО ЗАХОДА ВЫШЛИ две крупные правки.',
      'С последнего запуска вышла версия 1.5.',
    ]) {
      expect(shareText(`${known} ${fact} ${recall}`, '', tldr), fact).toBe(`${known} ${recall}`)
    }
    // Шаблонное начало ловится и корнем — два правила не разъедутся молча
    expect(shareText(`${known} ${PATCH_SINCE_LEAD.toLowerCase()}.`, '')).toBe(known)
  })

  test('«последний заход» без обновления — не факт о патче, остаётся', () => {
    const plain = 'Последнего захода хватило на вечер, а босс так и не побеждён.'
    expect(shareText(`${known} ${plain}`, '')).toBe(`${known} ${plain}`)
  })

  test('рядом с ценой: и хвост, и факт уходят вместе', () => {
    const tldr = 'Добавили режим'
    const tail = ' Сейчас −40%: $14.99 — до 17 августа.'
    expect(shareText(`${known} ${patchSentence(tldr)}${tail}`, tail, tldr)).toBe(known)
  })
})

describe('parseSharePickBody', () => {
  const ok = { appid: 620, source: 'untouched', kind: 'play', text: 'Причина', sig: 'x'.repeat(22) }

  test('форма в порядке — те же поля', () => {
    expect(parseSharePickBody(ok)).toEqual(ok)
    // игра чужого магазина — отрицательный appid, это законно
    expect(parseSharePickBody({ ...ok, appid: -101, kind: 'daily' })).toMatchObject({ appid: -101 })
  })

  test('мусор — null, а не приведение типом', () => {
    const bad: unknown[] = [
      null,
      'строка',
      [],
      { ...ok, appid: 0 },
      { ...ok, appid: 1.5 },
      { ...ok, appid: '620' },
      { ...ok, appid: 2 ** 60 },
      { ...ok, source: 'catalog' },
      { ...ok, source: undefined },
      { ...ok, kind: 'room' },
      { ...ok, text: '' },
      { ...ok, text: '   ' },
      { ...ok, text: 'я'.repeat(2001) },
      { ...ok, text: 42 },
      { ...ok, sig: undefined },
      { ...ok, sig: 42 },
    ]
    for (const b of bad) expect(parseSharePickBody(b), JSON.stringify(b)).toBeNull()
  })
})

describe('cleanReason', () => {
  test('управляющие знаки и двунаправленные метки — пробел, пробелы схлопнуты', () => {
    expect(cleanReason('  Раз\n\tдва‮ три​четыре\u0007 ')).toBe('Раз два три четыре')
  })

  test('длинное режется по слову до SHARED_REASON_MAX', () => {
    const long = 'слово '.repeat(200)
    const got = cleanReason(long)
    expect(got.length).toBeLessThanOrEqual(SHARED_REASON_MAX)
    expect(got.endsWith('…')).toBe(true)
  })
})

describe('quoted', () => {
  test('«ёлочки» снаружи, „лапки“ внутри — без «««', () => {
    expect(quoted('просто текст')).toBe('«просто текст»')
    expect(quoted('«Hades» ждёт')).toBe('«„Hades“ ждёт»')
  })
})

describe('pickShareUrl', () => {
  test('адрес с меткой воронки', () => {
    expect(pickShareUrl('https://imbored.cc', 'abcdefghjkmn')).toBe('https://imbored.cc/pick/abcdefghjkmn?ref=pick')
  })
})

describe('pickCopy', () => {
  test('нет выбора — приглашение, а не пустота', () => {
    const c = pickCopy(null)
    expect(c.title).toMatch(/imbored/)
    expect(c.description.length).toBeGreaterThan(0)
  })

  test('заголовок говорит, чей выбор: дня или вечера', () => {
    expect(pickCopy({ name: 'Hades', reason: 'Коротко.', kind: 'daily' }).title).toBe('«Hades» — моя игра дня')
    expect(pickCopy({ name: 'Hades', reason: 'Коротко.', kind: 'play' }).title).toBe(
      '«Hades» — imbored выбрал мне на вечер',
    )
  })

  test('описание — причина, обрезанная под сниппет', () => {
    const reason = 'Слово '.repeat(60).trim()
    const c = pickCopy({ name: 'Hades', reason, kind: 'play' })
    expect(c.description.length).toBeLessThanOrEqual(155)
  })
})
