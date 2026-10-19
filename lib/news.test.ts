import { describe, expect, test } from 'vitest'
import {
  bodyHash,
  detectLang,
  fetchGameNews,
  isPatchNote,
  isStoredPatch,
  looksTrivial,
  newsText,
  parseNewsRss,
} from './news'
import { parseSteamHtml } from './steamhtml'

/**
 * Фикстура — два реальных <item> из ленты CS2, снятых 13.08.2026 без правок:
 * патч и пост про наклейки. На этой паре и держится классификатор.
 */
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>RSS-канал 730</title>
  <item>
      <title>Обновление Counter-Strike 2</title>
      <description>&lt;p class=&quot;bb_paragraph&quot;&gt;[ КАРТЫ ]&lt;/p&gt;&lt;p class=&quot;bb_paragraph&quot;&gt;Fachwerk&lt;/p&gt;&lt;ul class=&quot;bb_ul&quot;&gt;&lt;li&gt;&lt;p class=&quot;bb_paragraph&quot;&gt;Карта обновлена до последней версии из мастерской (&lt;a class=&quot;bb_link&quot; href=&quot;https://steamcommunity.com/sharedfiles/filedetails/changelog/3442040035&quot; target=&quot;_blank&quot; rel=&quot;&quot; &gt;список изменений&lt;/a&gt;).&lt;/p&gt;&lt;/li&gt;&lt;/ul&gt;</description>
      <link><![CDATA[https://store.steampowered.com/news/app/730/view/689765787249934890]]></link>
      <pubDate>Wed, 12 Aug 2026 22:50:47 +0000</pubDate>
      <guid isPermaLink="true">https://store.steampowered.com/news/app/730/view/689765787249934890</guid>
    </item>
  <item>
      <title>Кёльн-2026: итоговые наклейки</title>
      <description>&lt;img src=&quot;https://clan.fastly.steamstatic.com/images/3381077/81b4cf.png&quot; /&gt;&lt;br&gt;&lt;br&gt;Сегодня мы выпускаем серию наклеек с итогами кёльнского мейджора.</description>
      <link><![CDATA[https://store.steampowered.com/news/app/730/view/676253085555756223]]></link>
      <pubDate>Wed, 29 Jul 2026 00:38:10 +0000</pubDate>
      <guid isPermaLink="true">https://store.steampowered.com/news/app/730/view/676253085555756223</guid>
      <enclosure url="https://clan.akamai.steamstatic.com/images/3381077/f3b4dd.png" length="0" type="image/png" />
    </item>
</channel></rss>`

describe('parseNewsRss', () => {
  const items = parseNewsRss(RSS, 730)

  test('разбирает все посты ленты', () => {
    expect(items).toHaveLength(2)
  })

  test('gid берётся из permalink и стабилен', () => {
    // это НЕ тот же id, что gid у JSON-эндпоинта — источники по нему не мешать
    expect(items[0].gid).toBe('689765787249934890')
    expect(items[1].gid).toBe('676253085555756223')
  })

  test('дата переводится в unix-секунды', () => {
    // ровно то же значение, что отдаёт JSON-эндпоинт для этого поста
    expect(items[0].publishedAt).toBe(1786575047)
  })

  test('заголовок и ссылка на месте, appid проставлен', () => {
    expect(items[0].title).toBe('Обновление Counter-Strike 2')
    expect(items[0].url).toBe('https://store.steampowered.com/news/app/730/view/689765787249934890')
    expect(items[0].appid).toBe(730)
  })

  test('двойное экранирование тела снимается и разбирается в блоки', () => {
    expect(items[0].blocks.map((b) => b.kind)).toEqual(['p', 'p', 'ul'])
    expect(newsText(items[0])).toContain('• Карта обновлена до последней версии из мастерской')
  })

  test('картинка поста берётся из enclosure', () => {
    expect(items[1].imageUrl).toBe('https://clan.akamai.steamstatic.com/images/3381077/f3b4dd.png')
    expect(items[0].imageUrl).toBeUndefined()
  })

  test('пустой и мусорный ответ не роняют разбор', () => {
    expect(parseNewsRss('', 730)).toEqual([])
    expect(parseNewsRss('<rss><channel></channel></rss>', 730)).toEqual([])
    expect(() => parseNewsRss('<item><item>', 730)).not.toThrow()
  })

  test('пост без даты или без заголовка пропускается', () => {
    const g = (n: number) => `https://store.steampowered.com/news/app/730/view/${n}`
    const broken = `<rss><channel>
      <item><title>Без даты</title><guid>${g(1)}</guid></item>
      <item><pubDate>Wed, 12 Aug 2026 22:50:47 +0000</pubDate><guid>${g(2)}</guid></item>
    </channel></rss>`
    expect(parseNewsRss(broken, 730)).toEqual([])
  })

  test('ссылка собирается нами, а не берётся из фида', () => {
    // в базу не должен попадать URL, подконтрольный третьей стороне
    expect(items[0].url).toBe('https://store.steampowered.com/news/app/730/view/689765787249934890')
  })
})

describe('parseNewsRss: гард permalink', () => {
  const item = (appidInLink: number, gid: string, title: string) => `
    <item><title>${title}</title><description>тело</description>
      <pubDate>Wed, 12 Aug 2026 22:50:47 +0000</pubDate>
      <guid isPermaLink="true">https://store.steampowered.com/news/app/${appidInLink}/view/${gid}</guid>
    </item>`
  const wrap = (inner: string) => `<rss><channel>${inner}</channel></rss>`

  test('посты с чужим appid отбрасываются', () => {
    // подтверждено на живой ленте: на запрос по 1091500 приезжали записи
    // агрегаторов с appid 252490 и 1086940
    const xml = wrap(item(1091500, '10', 'Свой') + item(252490, '11', 'Чужой') + item(1086940, '12', 'Чужой'))
    const got = parseNewsRss(xml, 1091500)
    expect(got.map((i) => i.gid)).toEqual(['10'])
  })

  test('внешние статьи агрегаторов не проходят', () => {
    const xml = wrap(`<item><title>Cyberpunk в 2026</title>
      <pubDate>Wed, 12 Aug 2026 22:50:47 +0000</pubDate>
      <guid>https://steamstore-a.akamaihd.net/news/externalpost/PCGamesN/18396</guid></item>`)
    expect(parseNewsRss(xml, 1091500)).toEqual([])
  })

  test('дубли gid в одной ленте схлопываются', () => {
    const xml = wrap(item(730, '77', 'Первый') + item(730, '77', 'Второй'))
    const got = parseNewsRss(xml, 730)
    expect(got).toHaveLength(1)
    expect(got[0].title).toBe('Первый')
  })

  test('пост из будущего отбрасывается', () => {
    // иначе запись с датой 3000 года навсегда прибивается к верху ленты
    const future = `<rss><channel><item><title>Из будущего</title>
      <pubDate>Fri, 01 Jan 3000 00:00:00 +0000</pubDate>
      <guid>https://store.steampowered.com/news/app/730/view/99</guid></item></channel></rss>`
    expect(parseNewsRss(future, 730)).toEqual([])
  })

  test('число разбираемых постов ограничено', () => {
    const many = wrap(
      Array.from({ length: 60 }, (_, i) => item(730, String(1000 + i), `Патч ${i}`)).join(''),
    )
    expect(parseNewsRss(many, 730).length).toBeLessThanOrEqual(25)
  })
})

describe('fetchGameNews', () => {
  test('кураторские отрицательные appid в сеть не ходят', async () => {
    // -101…-111 — игры других магазинов, в Steam их нет вовсе
    let called = false
    const spy = (async () => {
      called = true
      return new Response('')
    }) as unknown as typeof fetch
    expect(await fetchGameNews(-101, spy)).toBeNull()
    expect(await fetchGameNews(0, spy)).toBeNull()
    expect(called).toBe(false)
  })

  test('запрашивает русскую локаль ленты', async () => {
    let url = ''
    const spy = (async (u: string) => {
      url = u
      return new Response(RSS, { status: 200 })
    }) as unknown as typeof fetch
    const items = await fetchGameNews(730, spy)
    expect(url).toBe('https://store.steampowered.com/feeds/news/app/730/?l=russian')
    expect(items).toHaveLength(2)
  })

  test('403 на несуществующий appid отдаёт null, а не падение', async () => {
    const spy = (async () => new Response('', { status: 403 })) as unknown as typeof fetch
    expect(await fetchGameNews(99_999_999, spy)).toBeNull()
  })

  test('сетевая ошибка отдаёт null', async () => {
    const spy = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    expect(await fetchGameNews(730, spy)).toBeNull()
  })
})

describe('isPatchNote', () => {
  const bodyOf = (xml: string, i: number) => newsText(parseNewsRss(xml, 730)[i])

  test('патч Valve узнаётся по заголовку', () => {
    expect(isPatchNote('Обновление Counter-Strike 2', bodyOf(RSS, 0))).toBe(true)
  })

  test('патч без тега patchnotes всё равно узнаётся', () => {
    // у Cyberpunk именно этот пост приходит без tags — на теге строить нельзя
    expect(isPatchNote('Патч 2.31', 'Исправлены вылеты.')).toBe(true)
    expect(isPatchNote('Описание изменений в патче 2.3', '')).toBe(true)
  })

  test('пост про наклейки патчем не считается', () => {
    expect(isPatchNote('Кёльн-2026: итоговые наклейки', bodyOf(RSS, 1))).toBe(false)
  })

  test('распродажи, трейлеры и турниры отсекаются', () => {
    for (const t of [
      'Скидка 50% на выходных',
      'Трейлер на пятилетие — «Город легенд»',
      'Второй арсенальный призыв',
      'Вы в центре внимания! — Незабываемые',
      'Бесплатные выходные',
    ]) {
      expect(isPatchNote(t, '')).toBe(false)
    }
  })

  test('распродажа под словом «обновление» патчем не становится', () => {
    expect(isPatchNote('Обновление магазина: скидки до -75%', '')).toBe(false)
  })

  test('крупный патч не теряется из-за слова «скидки» в заголовке', () => {
    // счёт, а не жёсткий приоритет анти-сигналов: иначе ровно тот патч, ради
    // которого затевалась лента, ушёл бы в новости
    expect(isPatchNote('Обновление 1.5 — новый сезон и скидки', '')).toBe(true)
  })

  test('кириллица ловится после пробела: \\b тут не работает', () => {
    // /\\bпатч/u.test('новый патч') === false, потому что \\w это [A-Za-z0-9_];
    // регексп с \\b вокруг русских слов не совпал бы никогда
    expect(isPatchNote('Вышел патч 2.31', '')).toBe(true)
    expect(isPatchNote('Большое обновление', '')).toBe(true)
  })

  test('английские ленты классифицируются так же', () => {
    // у части игр перевода нет — фид приезжает на английском
    expect(isPatchNote('ELDEN RING - Patch Notes Version 1.16.1', '')).toBe(true)
    expect(isPatchNote('Release Note for 2025/12/16', '')).toBe(true)
    expect(isPatchNote('ELDEN RING - RAGING WOLF 1/6 SCALE STATUE', '')).toBe(false)
  })

  test('молчаливый заголовок разбирается по телу: список правок', () => {
    const changes = '• Исправлен вылет на старте\n• Добавлен новый режим\n• Улучшена стабильность'
    expect(isPatchNote('Заметки разработчиков', changes)).toBe(true)
    expect(isPatchNote('Заметки разработчиков', 'Мы рады сообщить о планах на год.')).toBe(false)
  })
})

/*
 * Заголовки ниже — живые, из ленты прода (выгрузка news_items от 24.09.2026 и
 * страницы, найденные аудитом); тела — их сокращённые пересказы того же вида.
 * Все эти посты классификатор считал патчами, а пересказ на «Что изменилось»
 * писал «добавлен режим…» о том, чего в игре ещё нет.
 */
describe('isPatchNote: то, что ещё не вышло, — не патч', () => {
  /** Список с глаголами изменений: у превью и дорожных карт он такой же, как у патча */
  const PLANNED = [
    '• Rapid Royale: added as a limited-time mode with a smaller ring',
    '• Vehicle balance: changed armor values for light tanks',
    '• Fixed spawn camping on Blackwell Fields — currently exploring options',
  ].join('\n')

  test('«Looking Ahead», дорожная карта и превью проигрывают даже списку правок', () => {
    // −4, а не −2: слово обновления (+2) плюс список правок (+2) — это ровно
    // счёт патча, и превью с таким телом иначе проходило бы порог
    for (const t of [
      'Battlefield 6/REDSEC: Looking Ahead To Season 5 And Beyond',
      'Marathon: дорожная карта обновлений на 2026 год',
      'New Year, New Tabletop Simulator — 2.0 Overhaul Roadmap',
      'Phasmophobia Quality of Life Update Preview',
      'SCUM | July Update Preview: New Tutorial, Master Hunter Quests & Mutant Animals',
      '1.27 preview',
      'Upcoming Anniversary Update: Lost & Found',
      '5 years of Black Mesa: Blue Shift & Upcoming Update!',
      'На следующей неделе выйдет летнее обновление 2026 года',
      'Завершение ПТЕ v.1 и превью патча',
    ]) {
      expect(isPatchNote(t, PLANNED), t).toBe(false)
    }
  })

  test('анонс патча с версией: без списка правок — новость, с полным списком — патч', () => {
    // «Update 1.1 coming soon!» — слово обновления и версия (+4) против −4.
    // Решает тело: «скоро, следите за новостями» — новость, а патчноут,
    // опубликованный за день до выхода, — патч, и «выйдет/добавят» вместо
    // «добавлено» в его пересказе держит модель (lib/llm, claudeNewsDigest)
    expect(isPatchNote('Update 1.1 coming soon!', 'Stay tuned — more details next week.')).toBe(false)
    expect(isPatchNote('Update 1.1 coming soon!', PLANNED)).toBe(true)
  })

  test('анонс стрима — не патч, даже с номером обновления в заголовке', () => {
    // «REDstreams» — одно слово: границы words() не дают найти «stream»
    // внутри него, поэтому стрим ловится вместе с приставкой
    const stream = 'Присоединяйтесь к REDstreams в четверг в 18:00 МСК: покажем, что ждёт вас в обновлении 2.2.'
    expect(isPatchNote('REDstreams —  Обновление 2.2', stream)).toBe(false)
    expect(isPatchNote("Civ Streams: Civ VII's Test of Time Update", stream)).toBe(false)
    // а «Stream Deck» в патчноуте — это функция, а не трансляция
    expect(isPatchNote('Update 1.2: Stream Deck support', '')).toBe(true)
  })

  test('вышедший патч рядом с планами остаётся патчем', () => {
    // посты «вот что вошло, а вот что дальше» — это и есть патч: слабые
    // слова про будущее стоят −2, и список правок их перевешивает
    const shipped = [
      '• Добавлены летние предметы кастомизации ресторана',
      '• Исправлен вылет при загрузке сохранения',
      '• Улучшена производительность кухни',
    ].join('\n')
    expect(
      isPatchNote('Летний патч и обновление о разработке: что выходит сейчас и что дальше 🍃🔥', shipped),
    ).toBe(true)
    expect(isPatchNote('Патч #14: Новый PvE-контент и планы на будущее!', shipped)).toBe(true)
    // «Upcoming Event» — про ивент, а не про то, что патч ещё не вышел
    expect(isPatchNote('Backend Update, UI Rework, Upcoming Event', shipped)).toBe(true)
    // явный патчноут с версией перевешивает и «preview», и дорожную карту —
    // версия в скобках тоже версия
    expect(isPatchNote('Christmas Update & Optimization Preview | Patch Notes - v1.4.9', '')).toBe(true)
    expect(isPatchNote('Roadmap & Major Update (1.1.5.7)', shipped)).toBe(true)
  })
})

describe('isPatchNote: «Update» в значении «новости о…»', () => {
  test('сводки сообщества, разработчиков и античита — не патчи', () => {
    // слово «Update» здесь — «рассказ о делах», и плюс за слово обновления
    // такой заголовок не получает; тело решает само
    const report = [
      'We’ve taken action against players who were found to be sharing their accounts.',
      'As a result, we have handed 258 Predator players 60-day suspensions.',
    ].join('\n')
    for (const t of [
      'An Update from the Anti Cheat Team - 10/08/2026',
      'Apex Legends: Anti-Cheat Update - 09/10/2026',
      'Controller Anti-Cheat Enforcement & Ban Wave Update — 09/02/2026',
      'Community Update - July 2026',
      'Battlefield 6 - Community Update - Top Gun Incoming',
      'Developer Update #8',
      'Diablo IV Developer Update - Season 14 | June, 2026',
      'An Update on the Roadmap',
      'Update about servers.',
    ]) {
      expect(isPatchNote(t, report), t).toBe(false)
    }
  })

  test('настоящий патч внутри сводки по-прежнему узнаётся', () => {
    const changes = [
      '• Fixed a crash when joining a cross-play lobby',
      '• Added cross-play invites to the friends list',
      '• Improved loading times on Steam Deck',
    ].join('\n')
    // «Hotfix» стоит своим словом — нейтрализуется только «Community Update»
    expect(isPatchNote('Community Update #34 - Connecting With Cross-Play & Hotfix #32', changes)).toBe(
      true,
    )
    // античит сам по себе не штраф: вышедшие правки со списком — патч
    expect(isPatchNote('Anti-Cheat Improvements: Phase One - Out Now', changes)).toBe(true)
  })
})

describe('isPatchNote: бета и тестовый сервер — не игра у всех', () => {
  test('анонс открытой беты и уголок разработчиков — не патчи', () => {
    const beta =
      'The public beta for our next major update is now available. To opt in, open Properties → Betas. ' +
      'We are still not sure if we should release this, so please share your feedback.'
    expect(isPatchNote('Hearts of Iron IV: Dev Corner & Open Beta: Energy #2', beta)).toBe(false)
    expect(isPatchNote('HOI IV - Open Beta Summer Edition™', beta)).toBe(false)
    expect(isPatchNote('Black Mesa: Beta Test For Major Update!', beta)).toBe(false)
    expect(isPatchNote('Обновление #70: V. 1.066.0 открытое бета-тестирование', beta)).toBe(false)
    expect(isPatchNote('Уголок разработчиков HOI IV | Война в третьем измерении — ВДВ в HOI', beta)).toBe(
      false,
    )
  })

  test('игра в бете и явный патчноут беты остаются патчами', () => {
    // голое «beta/бета» не штраф: «бета-версия» — это стадия самой игры, и
    // её патчи — патчи. Пересказ беты помечает модель (lib/llm, «В бете:»)
    expect(isPatchNote('Обновление 0.4 для бета-версии', '')).toBe(true)
    expect(isPatchNote('Beta Patch Notes - v0.110.0', '')).toBe(true)
  })
})

describe('isStoredPatch: сохранённая запись по нынешнему правилу', () => {
  const blocks = (lines: string[]) => [{ kind: 'ul' as const, items: lines.map((text) => [{ text }]) }]
  const changes = blocks(['Исправлен вылет при загрузке', 'Добавлен режим', 'Улучшена стабильность'])

  test('патч, записанный старым правилом, проверяется заново', () => {
    // строка лежит в базе с kind='patch' с прошлого опроса — новое правило
    // её не пускает, и ждать переопроса страница не обязана
    expect(
      isStoredPatch({ kind: 'patch', title: 'Battlefield 6/REDSEC: Looking Ahead To Season 5', blocks: changes }),
    ).toBe(false)
    expect(isStoredPatch({ kind: 'patch', title: 'Патч 2.31', blocks: changes })).toBe(true)
  })

  test('новость не становится патчем на чтении', () => {
    // обратного пути здесь нет: вид поста меняет только опрос
    expect(isStoredPatch({ kind: 'news', title: 'Патч 2.31', blocks: changes })).toBe(false)
  })
})

describe('looksTrivial', () => {
  test('обновление карты из мастерской — не для LLM', () => {
    expect(looksTrivial('Обновление CS2', 'Карта обновлена до последней версии из мастерской.')).toBe(
      true,
    )
  })

  test('пустое тело тривиально', () => {
    expect(looksTrivial('Обновление', '')).toBe(true)
  })

  test('содержательный патч тривиальным не считается', () => {
    const long = Array.from({ length: 12 }, (_, i) => `• Исправлена ошибка номер ${i} в системе`).join('\n')
    expect(looksTrivial('Патч 2.31', long)).toBe(false)
  })
})

describe('bodyHash и detectLang', () => {
  test('отпечаток не меняется от пробелов и от ссылки на картинку', () => {
    // иначе за один и тот же патч платили бы Claude на каждом опросе
    const a = parseNewsRss(RSS, 730)[0].blocks
    const b = parseSteamHtml(
      '<p class="bb_paragraph">[ КАРТЫ ]</p>\n\n  <p>Fachwerk</p><ul><li><p>Карта обновлена до последней версии из мастерской (<a href="https://steamcommunity.com/x">список изменений</a>).</p></li></ul>',
    )
    expect(bodyHash(a)).toBe(bodyHash(b))
  })

  test('отпечаток меняется, когда издатель переписал патчноут', () => {
    expect(bodyHash(parseSteamHtml('<p>было</p>'))).not.toBe(bodyHash(parseSteamHtml('<p>стало</p>')))
  })

  test('язык поста определяется по доле кириллицы', () => {
    expect(detectLang('Исправлены вылеты при загрузке')).toBe('ru')
    expect(detectLang('Fixed a crash on startup')).toBe('en')
    expect(detectLang('')).toBe('en')
    // смешанный пост с латинскими именами методов всё ещё русский
    expect(detectLang('Добавлен метод Instance.TracePlayer и CSPlantedC4.IsActive')).toBe('ru')
  })
})
