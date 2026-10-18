import { describe, expect, test } from 'vitest'
import { PATCH_SINCE_LEAD, patchSinceLead } from './comeback'
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

/**
 * Английская причина в «Отправить другу». shareText языка не знает: правила
 * обоих языков работают разом, и английский текст на публичной /pick не
 * уносит ни цены, ни чужого последнего запуска — это вопрос приватности.
 * Фраза о патче собирается тем же patchSentence, что пишет её в причину.
 */
describe('shareText: английская причина', () => {
  const known = 'You already have 40 h in “Hades”.'
  const recall = "The first ten minutes or so will go to remembering the controls — that's normal."

  test('ценовой хвост шаблона и слова о деньгах выпадают, остальное на месте', () => {
    const reason = '“Hades” isn\'t in your library, but its tag (Roguelike) matches what you play the most.'
    const tail = ' 40% off now: 14,99 $ instead of 24,99 $.'
    expect(shareText(reason + tail, tail)).toBe(reason)
    for (const money of [
      "It's $24.99 on Steam.",
      "It's 1 999 ₽ on Steam.",
      '40% off right now.',
      "It's free.",
      'It is free-to-play, so nothing to lose.',
      'It is on sale this week.',
      'Cheaper than usual right now.',
      'The price is fair for what you get.',
      'It costs less than a pizza.',
      'A real bargain.',
    ]) {
      expect(shareText(`First. ${money} Last.`, ''), money).toBe('First. Last.')
    }
  })

  test('не про деньги — не трогаем: проценты отзывов, «worth», кооператив', () => {
    for (const keep of [
      '92% of reviews are positive.',
      'Worth an hour of your evening.',
      'Co-op for 2–4 players.',
      'It has been a hit since launch.',
    ]) {
      expect(shareText(keep, ''), keep).toBe(keep)
    }
  })

  test('факт о патче шаблона уходит вместе с хвостом пересказа', () => {
    const tldr = 'Added a new biome. Reworked combat and progression. Brought back four-player co-op.'
    const fact = patchSentence(tldr, Infinity, 'en')!
    expect(fact.startsWith(patchSinceLead('en'))).toBe(true)
    expect(shareText(`${known} ${fact} ${recall}`, '', tldr)).toBe(`${known} ${recall}`)
    expect(shareText(`${known} ${fact}`, '')).not.toContain('Since you last played')
    const named = patchSentence('Update 1.5: a new biome and two bosses', Infinity, 'en')!
    expect(named).toBe(`${patchSinceLead('en')}: a new biome and two bosses.`)
    expect(shareText(`${known} ${named}`, '', 'Update 1.5: a new biome and two bosses')).toBe(known)
    // По глоссарию — с названием игры: вводная по-прежнему в самом начале
    const forGame = patchSentence(tldr, Infinity, 'en', 'Hades')!
    expect(forGame.startsWith(`${patchSinceLead('en')} for “Hades”: `)).toBe(true)
    expect(shareText(`${known} ${forGame} ${recall}`, '', tldr)).toBe(`${known} ${recall}`)
  })

  test('модель пересказала факт своими словами — выпадает и так', () => {
    for (const fact of [
      'Go back to “Hades”: since you last played, a major update dropped — new maps.',
      'Since your last session, a big patch landed with new maps.',
      'A lot has changed since you played.',
      'SINCE THEY LAST PLAYED, TWO BIG UPDATES CAME OUT.',
      // Пересказы, которые прежнее правило пропускало на публичную /pick
      'A big update dropped since the last time you played: new weapons.',
      'Since you were last here, a major update came out: new weapons.',
      'Since you stopped playing, it got a new biome.',
      'since you were last here, the Labor of Love update added new pets.',
      'A lot changed in “Terraria” since you dropped it: new pets.',
      'Since you abandoned “Terraria”, it got a major update.',
      'It got a major update after you put it down.',
      'While you were away, “Terraria” got a major update.',
      "Since you've been away, the devs added a new biome.",
      'In your absence, the game got a co-op mode.',
    ]) {
      expect(shareText(`${known} ${fact} ${recall}`, ''), fact).toBe(`${known} ${recall}`)
    }
  })

  test('«last session» без «since» — не факт о патче, остаётся', () => {
    const plain = 'Your last session ended on a cliffhanger, and the boss is still standing.'
    expect(shareText(`${known} ${plain}`, '')).toBe(`${known} ${plain}`)
    for (const keep of [
      "Since you're new to the genre, this is a gentle start.",
      'Since you like roguelikes, this one fits.',
      'It has been a hit since launch.',
    ]) {
      expect(shareText(keep, ''), keep).toBe(keep)
    }
  })

  test('суммы в любой записи — знак перед числом, код валюты, валюта словом', () => {
    for (const money of [
      "It'll set you back 1,999 rubles.",
      "It's RUB 1,999 right now.",
      "It's 9.99 USD right now.",
      "It's ₽999 right now, down from ₽1,999.",
      'A ₽1,999 purchase, but worth it.',
      "It's a purchase at 1,999 rubles.",
      'Down to 999 rubles.',
      'Only 499 RUB.',
      'Just ¥1,980 in the store.',
      'Just ₹499 in the store.',
      'Only zł 49 now.',
      'Under ten bucks.',
      "It's 4 499 ₸ on Steam.",
    ]) {
      expect(shareText(`First. ${money} Last.`, ''), money).toBe('First. Last.')
    }
  })

  test('скидка без минуса: save, marked down, half off, percent off, cheaper', () => {
    for (const money of [
      'Save 40% if you grab it this week.',
      "Right now it's marked down 40%.",
      'Half off right now.',
      '50 percent off this week.',
      "It's 40% cheaper than usual.",
      'You can grab it for free this weekend.',
      "It's free to play.",
    ]) {
      expect(shareText(`First. ${money} Last.`, ''), money).toBe('First. Last.')
    }
  })

  test('ценовой хвост на /en с ценой знаком впереди — выпадает, даже если роут передал другой хвост', () => {
    const base = '“Hades” isn\'t in your library, but its tag (Roguelike) matches what you play the most.'
    const enTail = " It's ₽1,999 on Steam."
    // хвост не совпал (роут отрезал по русскому) — предложение с суммой всё равно уходит
    expect(shareText(base + enTail, ' В Steam — 1\u00a0999\u00a0₽.')).toBe(base)
  })

  test('«free» не о деньгах и слова о деньгах в названиях игр — не трогаем', () => {
    for (const keep of [
      "With the whole evening free, “Disco Elysium” is the deep story you've been saving.",
      "Your evening is free, so sink into “Disco Elysium” — it's closest to what you love.",
      'Feel free to take it slow.',
      'A free-roam sandbox with no timers.',
      'Lots of free time in the open world.',
      '“Cheap Golf” is short and silly, perfect for tonight.',
      '“Garage Sale” is a cozy puzzler.',
      '“Free Fire” is a fast shooter you can play with friends.',
      '“Cost of Living” is a calm sim for a quiet night.',
    ]) {
      expect(shareText(keep, ''), keep).toBe(keep)
    }
  })

  test('русские правила на месте и для английского вызова — языки не мешают друг другу', () => {
    const ru = `У тебя в «Hades» уже 40 ч. ${PATCH_SINCE_LEAD}: новые карты. Зайдёт на вечер.`
    expect(shareText(ru, '', 'Новые карты')).toBe('У тебя в «Hades» уже 40 ч. Зайдёт на вечер.')
  })

  /*
   * Русская причина режется ровно как раньше: английские слова о деньгах к
   * русскому предложению не применяются. Прежде «free-to-play шутер» и
   * «Cheap Golf» в русской причине доезжали до ссылки — и доезжают.
   */
  test('русская причина с латиницей — прежний текст: ни название игры, ни «free-to-play» не режут её', () => {
    for (const keep of [
      '«Cheap Golf» — короткая и смешная, на вечер хватит.',
      '«Garage Sale» — уютная головоломка.',
      '«Warframe» — free-to-play шутер, где можно играть с друзьями.',
      '«Price of Glory» — стратегия. Зайдёт на вечер.',
      '«The Sale» — детектив. Его ценят за сюжет.',
      '«Hurry Up» — аркада, где всё решают секунды.',
    ]) {
      expect(shareText(keep, ''), keep).toBe(keep)
    }
    // а русская цена по-прежнему уходит
    expect(shareText('«Cheap Golf» — короткая. Стоит 499 ₽.', '')).toBe('«Cheap Golf» — короткая.')
  })

  test('английская причина с названием кириллицей — английские правила: сумма уходит, имя не мешает', () => {
    expect(shareText("“Смута” isn't in your library. It's 999 rubles right now.", '')).toBe("“Смута” isn't in your library.")
    expect(shareText('“Цена свободы” is a story you finish in an evening.', '')).toBe(
      '“Цена свободы” is a story you finish in an evening.',
    )
  })
})

describe('quoted, pickShareUrl, pickCopy по-английски', () => {
  test('quoted: “…” снаружи, ‘…’ внутри — без ““', () => {
    expect(quoted('just text', 'en')).toBe('“just text”')
    expect(quoted('“Hades” is waiting', 'en')).toBe('“‘Hades’ is waiting”')
    expect(quoted('«Hades» ждёт', 'ru')).toBe('«„Hades“ ждёт»')
  })

  test('pickShareUrl: английская ссылка ведёт на /en/pick', () => {
    expect(pickShareUrl('https://imbored.cc', 'abcdefghjkmn', 'en')).toBe(
      'https://imbored.cc/en/pick/abcdefghjkmn?ref=pick',
    )
    expect(pickShareUrl('https://imbored.cc', 'abcdefghjkmn', 'ru')).toBe(
      'https://imbored.cc/pick/abcdefghjkmn?ref=pick',
    )
  })

  test('pickCopy: глоссарий, без кириллицы', () => {
    const none = pickCopy(null, 'en')
    expect(none).toEqual({
      title: "Tonight's pick — imbored",
      description: 'imbored picks one game for tonight from your Steam library — and tells you why.',
      eyebrow: "IMBORED · TONIGHT'S PICK",
      foot: 'Your turn? One game, picked in a minute — imbored.cc',
    })
    const daily = pickCopy({ name: 'Hades', reason: 'Short.', kind: 'daily' }, 'en')
    expect(daily.title).toBe('“Hades” — my game of the day')
    expect(daily.eyebrow).toBe('MY GAME OF THE DAY')
    const play = pickCopy({ name: 'Hades', reason: 'Short.', kind: 'play' }, 'en')
    expect(play.title).toBe('“Hades” — imbored picked my game for tonight')
    expect(play.eyebrow).toBe('IMBORED PICKED MY GAME FOR TONIGHT')
    expect(play.description).toBe('Short.')
    for (const c of [none, daily, play]) expect(JSON.stringify(c)).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('без locale — прежний русский текст', () => {
    expect(pickCopy(null)).toEqual(pickCopy(null, 'ru'))
    expect(pickCopy(null).foot).toBe('А тебе? Подберёт одну игру за минуту — imbored.cc')
    expect(pickCopy({ name: 'Hades', reason: 'Коротко.', kind: 'daily' }).eyebrow).toBe('МОЯ ИГРА ДНЯ')
  })
})
