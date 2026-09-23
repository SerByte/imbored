/**
 * Разбор текстов отзывов без модели: полосы, время до веселья, наигранное.
 *
 * Правило владельца — никакого нового LLM. Семантика игры (lib/semantics.ts)
 * поэтому уточняется не пересказом отзывов, а счётом: какая доля отзывов
 * говорит «пара забегов», «ещё один ход», «раскачивается часов десять»,
 * «уютная». Это грубее модели, зато детерминированно, бесплатно и проверяется
 * фикстурами без сети.
 *
 * Чего здесь нет и не будет:
 *   - сарказма («очень расслабляет, ага») — регэксп его не видит;
 *   - сложных отрицаний («anything but relaxing»). Ловятся только простые:
 *     отрицание в трёх словах перед фразой и внутри той же части фразы.
 * Шум от этого гасится выше: lib/semantics не двигает приор при паре
 * отзывов и весит отзывы как n/(n+20).
 *
 * Языки — только русский и английский: словари полос написаны на них. Отзыв
 * на другом языке в знаменатель долей не идёт, иначе сотня китайских отзывов
 * разбавила бы «hard» у Hollow Knight до нуля. В статистику наигранного идут
 * все: минуты от языка не зависят.
 */
import type { ReviewsResponse } from './reviews'

export type ReviewLang = 'ru' | 'en' | 'other'

/**
 * Отзыв целиком, без отбора. parseReviews в lib/reviews отбрасывает всё, что
 * написано раньше двух часов игры: для pros/cons это разумно, а здесь как раз
 * короткие негативы и нужны — «через час бросил, скучно» и есть сигнал
 * медленного старта.
 */
export type RawReview = {
  id: string
  text: string
  lang: ReviewLang
  votedUp: boolean
  votesUp: number
  /** минуты наигранного на момент отзыва */
  playtimeAtReview: number
  /** минуты за всё время — на момент ответа Steam */
  playtimeForever: number
}

export const LANES = [
  'shortSession',
  'longSession',
  'slowStart',
  'hard',
  'relaxing',
  'complex',
  'grind',
  'story',
  'bugs',
] as const

export type Lane = (typeof LANES)[number]

/**
 * Сколько отзывов попали в полосу. Доли — по весу, не по штукам: отзыв, за
 * который проголосовали, говорит за многих.
 */
export type LaneStat = {
  count: number
  /** сумма весов попавших отзывов, вес — 1 + log1p(votesUp) */
  weighted: number
  /** доля веса среди всех разобранных RU/EN отзывов, 0..1 */
  share: number
  /** то же среди позитивных; 0, если позитивных нет */
  sharePos: number
  /** то же среди негативных; 0, если негативных нет */
  shareNeg: number
}

export type MinedReviews = {
  /** разобрано отзывов на русском и английском — знаменатель долей */
  n: number
  nPos: number
  nNeg: number
  lanes: Record<Lane, LaneStat>
  /**
   * Медиана «становится интересно через N часов» по отзывам, где такое число
   * названо. null — не назвал никто.
   */
  timeToFunHours: number | null
  /** сколько отзывов назвали такое число */
  timeToFunMentions: number
  playtime: {
    /** все отзывы ответа, на любом языке */
    total: number
    medianPosMin: number | null
    medianNegMin: number | null
    /** доля негативов, написанных раньше двух часов игры; null — негативов нет */
    negShortShare: number | null
  }
}

/** Граница «короткого» негатива: окно возврата Steam, два часа */
const SHORT_NEG_MIN = 120

/**
 * «After 300 hours it's still fun» — это не время до веселья, а похвальба
 * наигранным. Числа больше потолка выбрасываются.
 */
const MAX_TTF_HOURS = 40

/** Сколько слов перед фразой проверяется на отрицание */
const NEG_WINDOW = 3

/**
 * Язык отзыва. Главный источник — поле language, которое Steam кладёт в
 * каждый отзыв: оно отличает английский от немецкого, а счёт букв — нет.
 * Счёт кириллицы и латиницы — запасной путь, когда поля нет.
 */
const STEAM_LANGS: Record<string, ReviewLang> = { english: 'en', russian: 'ru' }

function langOf(language: unknown, text: string): ReviewLang {
  if (typeof language === 'string' && language) return STEAM_LANGS[language] ?? 'other'
  const cyr = text.match(/[а-яё]/gi)?.length ?? 0
  const lat = text.match(/[a-z]/gi)?.length ?? 0
  if (cyr + lat === 0) return 'other'
  return cyr >= lat ? 'ru' : 'en'
}

function minutes(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0
}

/**
 * Все отзывы ответа appreviews: без порога наигранного и без потолка, дубли
 * по recommendationid выкинуты. null — Steam сказал, что ответа нет
 * (success != 1), как у parseReviews.
 */
export function parseReviewsRaw(json: unknown): RawReview[] | null {
  const data = json as ReviewsResponse | null
  if (data?.success !== 1) return null
  const seen = new Set<string>()
  const out: RawReview[] = []
  for (const r of Array.isArray(data.reviews) ? data.reviews : []) {
    const id = r?.recommendationid
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    const text = typeof r.review === 'string' ? r.review : ''
    out.push({
      id,
      text,
      lang: langOf(r.language, text),
      votedUp: r.voted_up === true,
      votesUp: minutes(r.votes_up),
      playtimeAtReview: minutes(r.author?.playtime_at_review),
      playtimeForever: minutes(r.author?.playtime_forever),
    })
  }
  return out
}

/**
 * Текст к виду, в котором по нему ищут полосы: без BBCode и ссылок, в нижнем
 * регистре, ё → е, типографские апострофы → ', перевод строки — конец фразы.
 */
export function normalizeReviewText(text: string): string {
  return text
    .replace(/\[\/?[a-z0-9*]+(?:=[^\]]*)?\]/gi, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s*\n\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
}

/*
 * Словари полос. Каждая строка — исходник регэкспа по нормализованному тексту
 * (нижний регистр, ё уже стала е). Границы слов ставит lane() — юникодными
 * lookaround'ами, а НЕ `\b`: в JS `\b` знает только ASCII, и /\bсложн/u не
 * совпадает с «очень сложная» никогда (см. то же предупреждение в lib/news).
 * Поэтому «несложная» не ловится как «сложн…», а «лагерь» — как «лаг».
 *
 * Слова написаны узко там, где широкое слово врёт: не «hard», а «very hard» и
 * «hard game» (hard drive, hard choices); не «оптимизация», а «ужасная
 * оптимизация» (хорошую тоже хвалят этим словом).
 */
const LANE_TERMS: Record<Lane, string[]> = {
  shortSession: [
    'quick (?:sessions?|runs?|matches|match|games?|rounds?|bursts?)',
    'short (?:sessions?|runs?|bursts?|matches|match|rounds?)',
    'pick[- ]up[- ]and[- ]play',
    '(?:coffee|lunch) breaks?',
    'bite[- ]sized',
    'on the go',
    '(?:\\d{1,2}|a few|few|couple of)[- ]minutes? (?:runs?|sessions?|matches|match|rounds?|at a time)',
    '(?:a|one) run or two',
    'пар[уы] (?:каток|забегов|партий|матчей|раундов)',
    'на полчаса',
    '(?:коротк|быстр)\\p{L}* (?:сесси|забег|катк|парти|матч|раунд)\\p{L}*',
    'в перерывах',
    'на (?:обеденн\\p{L}* )?перерыв\\p{L}*',
    'между делом',
    'на (?:\\d{1,2}|пару|несколько|пять|десять|двадцать) минут\\p{L}*',
    '(?:забег|катк|парти|матч|раунд)\\p{L}* (?:на|по) \\d{1,2}(?:[- ]\\d{1,2})? минут\\p{L}*',
  ],
  longSession: [
    'one more (?:turn|day|night)',
    'hours? (?:just )?(?:fly|flew|flies|disappear\\p{L}*|vanish\\p{L}*|melt\\p{L}*)',
    'time (?:flies|flew)',
    'los[et] (?:all )?track of time',
    "(?:can'?t|couldn'?t|cannot) (?:put it down|stop playing)",
    'hard to put down',
    '(?:all|whole|entire) (?:night|evening|weekend)',
    'until (?:\\d{1,2} ?am|dawn|sunrise|the morning)',
    'long (?:play ?)?sessions?',
    'marathon\\p{L}*',
    'binge\\p{L}*',
    'не (?:мог\\p{L}* |могу |возможно )?оторваться',
    'невозможно оторваться',
    'еще (?:один|одну) (?:ход|день|ночь)',
    'час\\p{L}* (?:пролетают|пролетели|пролетает|летят|улетают|улетели)',
    'время (?:летит|пролетает|пролетело|улетает)',
    'не замети\\p{L}*,? как (?:прошл\\p{L}*|пролетел\\p{L}*)',
    '(?:всю|целую) ночь',
    '(?:весь|целый) (?:вечер|день)',
    '(?:все|целые) выходные',
    'до (?:утра|рассвета|\\d ночи)',
    '(?:пожирател|убийц)\\p{L}* времени',
    'залип\\p{L}*',
    'затягива(?:ет|ющ\\p{L}*)',
    '(?:долг|длинн)\\p{L}* сесси\\p{L}*',
  ],
  slowStart: [
    'slow (?:start|burn|beginning|opening)',
    'slow to start',
    'starts? (?:off )?slow(?:ly)?',
    'takes (?:a while|some time|time|hours) to (?:get into|get going|click|pick up|get good|open up)',
    'give it (?:a few|some|a couple(?: of)?) hours',
    'stick with it',
    'push through',
    'hard to get into',
    'gets (?:much |a lot |way )?better (?:later|with time|as you (?:progress|go))',
    '(?:long|boring|tedious) tutorial',
    'tutorial (?:is|was) (?:too )?(?:long|boring|tedious)',
    '(?:медленн|затянут|нудн|скучн)\\p{L}* (?:старт|начал|вступлени|пролог|обучени)\\p{L}*',
    '(?:долго )?раскачива\\p{L}*',
    'после обучения',
    'дайте (?:игре )?шанс',
    'не бросайте',
    '(?:сложно|трудно|тяжело) втянуться',
    'не сразу (?:затягивает|раскрывается|цепляет|понятно)',
    '(?:долг|длинн)\\p{L}* обучени\\p{L}*',
  ],
  hard: [
    'punishing',
    'souls?[- ]?like',
    'dark souls',
    'brutal(?:ly)? (?:hard|difficult|difficulty)',
    'unforgiving',
    'hard as nails',
    'challenging',
    'difficult',
    '(?:very|really|super|extremely|insanely|incredibly|too|so|pretty|quite|damn) hard',
    'hard game',
    '(?:high|steep|punishing) difficulty',
    'difficulty (?:spike|curve)s?',
    'die (?:a lot|constantly|often|over and over)',
    'died (?:a lot|so many times|hundreds of times)',
    'git gud',
    'rage[- ]?(?:quit\\p{L}*|inducing)',
    'masochis\\p{L}*',
    'сложн\\p{L}*(?! (?:сказать|рекомендовать|посоветовать|описать|объяснить|разобраться|понять|передать|назвать|оценить))',
    'хардкор\\p{L}*',
    'беспощадн\\p{L}*',
    'наказыва\\p{L}*',
    'соулс\\p{L}*',
    'дарк ?соулс\\p{L}*',
    'умира\\p{L}* (?:постоянно|часто|много|снова)',
    'умер\\p{L}* (?:сотни|тысячи|много|кучу) раз',
    'челлендж\\p{L}*',
    '(?:очень|слишком|жутко|безумно|адски) (?:тяжел|трудн)\\p{L}*',
    'потн\\p{L}*',
  ],
  relaxing: [
    'relax\\p{L}*',
    'cozy',
    'cosy',
    'comfy',
    'chill(?:ed|ing)?',
    'wholesome',
    'calm(?:ing)?',
    'soothing',
    'peaceful',
    'zen',
    'laid[- ]back',
    'comfort(?:ing)? game',
    'unwind\\p{L}*',
    'stress[- ]?free',
    'low[- ]stress',
    'therapeutic',
    'meditative',
    'расслаб\\p{L}*',
    'уютн\\p{L}*',
    'спокойн(?:ая|ой|ую|ое|ые|ых) (?:игр|атмосфер|геймплей|музык|темп)\\p{L}*',
    'медитативн\\p{L}*',
    'умиротвор\\p{L}*',
    'антистресс\\p{L}*',
    'лампов\\p{L}*',
    'чилл?\\p{L}*',
    'отдыха\\p{L}* душой',
    'разгрузить (?:голову|мозг)',
    'без стресса',
    'ненапряжн\\p{L}*',
    'нетороплив\\p{L}*',
    'успокаива\\p{L}*',
  ],
  complex: [
    '(?:steep )?learning curve',
    'complex\\p{L}*',
    'complicated',
    'deep (?:mechanics|systems|gameplay|strategy)',
    '(?:lots|tons|plenty|a lot) of (?:mechanics|systems|micromanagement)',
    'so many (?:mechanics|systems)',
    'overwhelm\\p{L}*',
    '(?:wiki|guides?) open',
    'read (?:the|a) wiki',
    'spreadsheet\\p{L}*',
    'micro[- ]?manag\\p{L}*',
    'intricate',
    'hard to (?:learn|master)',
    '(?:много|куча|кучу|множество|тонна|тонну) (?:механик|систем|нюансов)',
    'порог\\p{L}* входа',
    'кривая обучения',
    'сложно (?:разобраться|освоить|понять)',
    '(?:сложн|запутанн|перегружен)\\p{L}* (?:механик|систем|экономик|интерфейс|управлени)\\p{L}*',
    '(?:читать|смотреть|открыть|открытой|открытым) (?:вики|гайд\\p{L}*)',
    'комплексн\\p{L}*',
    'запутанн\\p{L}*',
    'микроменеджмент\\p{L}*',
    'глубок\\p{L}* (?:механик|систем|геймплей|стратеги)\\p{L}*',
  ],
  grind: [
    'grind\\p{L}*',
    'repetitive',
    'repetition',
    'tedious',
    'padding',
    'padded',
    'busywork',
    'гринд\\p{L}*',
    'однообраз\\p{L}*',
    'нудн\\p{L}*',
    'рутин\\p{L}*',
    'фарм\\p{L}*',
    'душн\\p{L}*',
    'монотонн\\p{L}*',
    'повторяющ\\p{L}*',
  ],
  story: [
    'story',
    'storyline',
    'stories',
    'narrative',
    'plot',
    '(?:great|good|excellent|amazing|brilliant|bad|poor|terrible) writing',
    'lore',
    'characters?',
    'dialogu?es?',
    'сюжет\\p{L}*',
    'истори\\p{L}*',
    'повествовани\\p{L}*',
    'персонаж\\p{L}*',
    'лор(?:а|е|ом|у)?',
    'концовк\\p{L}*',
    'сценари\\p{L}*',
    'диалог\\p{L}*',
    'нарратив\\p{L}*',
  ],
  bugs: [
    'bug(?:s|gy|ged)?(?! ?-? ?free)',
    'glitch(?:es|y)?',
    'crash(?:es|ed|ing)?',
    'broken',
    'unplayable',
    'unstable',
    'stutter\\p{L}*',
    '(?:poor|bad|terrible|horrible|awful)(?:ly)? optimi[sz]\\p{L}*',
    'unoptimi[sz]ed',
    'optimi[sz]ation (?:is )?(?:bad|terrible|awful|horrible|poor)',
    'memory leaks?',
    '(?:fps|frame ?rate|frame) drops?',
    'lag(?:s|gy|ging)?',
    'desync\\p{L}*',
    'soft ?locks?',
    'game[- ]breaking',
    'баг\\p{L}*',
    'глюч\\p{L}*',
    'глюк\\p{L}*',
    'вылет\\p{L}*',
    'краш\\p{L}*',
    'лаг(?:и|ов|а|ает|ают|ал|али|ать|ающ\\p{L}*)?',
    'фриз\\p{L}*',
    'тормоз(?:ит|ят|ил|ила|или|ов)',
    'сломан\\p{L}*',
    'неиграбельн\\p{L}*',
    '(?:ужасн|отвратительн|плох|кошмарн|никак)\\p{L}* оптимизаци\\p{L}*',
    'оптимизаци\\p{L}* (?:хромает|ужасн\\p{L}*|отвратительн\\p{L}*|никак\\p{L}*|плох\\p{L}*|кошмарн\\p{L}*|отсутствует)',
    '(?:проседани|просадк)\\p{L}* (?:фпс|fps|кадров)',
  ],
}

const NB = '[\\p{L}\\p{N}]'
const words = (alts: string, flags = 'gu') => new RegExp(`(?<!${NB})(?:${alts})(?!${NB})`, flags)

const LANE_RE = Object.fromEntries(
  LANES.map((lane) => [lane, words(LANE_TERMS[lane].join('|'))]),
) as Record<Lane, RegExp>

/*
 * Отрицание. Смотрим до трёх слов перед фразой, но не дальше границы части
 * фразы: в «not great, but relaxing» запятая отрезает «not» от «relaxing».
 * «Не только» и «not only» — не отрицание: «не только уютная, но и…».
 */
const NEGATORS = new Set([
  'not',
  'no',
  'never',
  'without',
  'zero',
  'hardly',
  'barely',
  'nothing',
  'isnt',
  'wasnt',
  'arent',
  'dont',
  'doesnt',
  'didnt',
  'cant',
  'не',
  'нет',
  'ни',
  'без',
  'никогда',
  'ничуть',
  'нисколько',
])
const ONLY = new Set(['only', 'только'])
const CLAUSE_END = /[.!?;:,()«»"—–]/

function isNegator(word: string): boolean {
  return NEGATORS.has(word) || word.endsWith("n't")
}

function negatedAt(text: string, at: number): boolean {
  const from = Math.max(0, at - 60)
  const head = text.slice(from, at)
  let start = 0
  for (let i = head.length - 1; i >= 0; i--) {
    if (CLAUSE_END.test(head[i])) {
      start = i + 1
      break
    }
  }
  const tokens = head.slice(start).split(' ').filter(Boolean)
  // Срез мог начаться посреди слова: обрубок «не» от «полне» — не отрицание
  if (start === 0 && from > 0) tokens.shift()
  const near = tokens.slice(-NEG_WINDOW)
  return near.some((w, i) => isNegator(w) && !ONLY.has(near[i + 1] ?? ''))
}

/**
 * Русское отрицание после слова: «багов нет», «лагов не было». Голое «не»
 * после фразы сюда не входит: «сложная, но не для всех» — всё равно сложная.
 */
const NEGATED_AFTER = new RegExp(
  `^ (?:нет|не было|не замечено|не замечал\\p{L}*|не заметил\\p{L}*|не встреч\\p{L}*|не обнаруж\\p{L}*|отсутству\\p{L}*)(?!${NB})`,
  'u',
)

function hitsLane(text: string, re: RegExp): boolean {
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (negatedAt(text, at) || NEGATED_AFTER.test(text.slice(at + m[0].length))) continue
    return true
  }
  return false
}

/*
 * «Время до веселья»: число часов рядом с глаголом перелома — «gets good after
 * 10 hours», «через пять часов затягивает», «первые 3 часа скучные». Голое
 * «after 100 hours» не годится: чаще это похвальба наигранным, поэтому нужен
 * глагол перелома рядом, а числа выше MAX_TTF_HOURS выбрасываются.
 */
const NUM_WORDS: Record<string, number> = {
  'a couple of': 2,
  'a couple': 2,
  'couple of': 2,
  couple: 2,
  'a few': 3,
  few: 3,
  an: 1,
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  ten: 10,
  twenty: 20,
  пару: 2,
  пары: 2,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  десять: 10,
  двадцать: 20,
  несколько: 3,
}

const NUM =
  '\\d{1,3}(?:[.,]\\d)?|(?:a )?couple(?: of)?|(?:a )?few|an?|one|two|three|four|five|six|ten|twenty|' +
  'пар[уы]|два|две|три|четыре|пять|шесть|десять|двадцать|несколько'
const UNIT = 'hours?|hrs?|h|minutes?|mins?|полчаса|час(?:а|ов)?|ч|минут[уы]?|мин'
/** Количество: (число)(верх диапазона)?(единица). Ровно три группы — их читает ttfOf */
const QTY = `(?:(${NUM})(?: ?(?:-|–|to|до) ?(\\d{1,3}))? ?)?(${UNIT})(?!\\p{L})`
const W = '[^\\s.!?;]+'
/*
 * «Gets boring after 10 hours», «через десять часов становится скучно» — это
 * время до скуки, а не до веселья, и в негативах оно встречается чаще, чем
 * хотелось бы. Слово скуки рядом с глаголом перелома гасит совпадение.
 */
const EN_BAD =
  '(?:boring|repetitive|stale|old|tedious|worse|dull|annoying|frustrating|grindy|samey|bland|monotonous|tiring|tiresome|meh|bad|unfun)(?!\\p{L})'
const RU_BAD = '(?:скучн|однообразн|нудн|надоеда|приеда|утомля|душн|хуже|пресн|монотонн)\\p{L}*'
/** Слово между глаголом перелома и числом — любое, кроме слова скуки */
const W_EN = `(?!${EN_BAD})${W}`
const W_RU = `(?!${RU_BAD})${W}`
const EN_TURN =
  '(?:gets?|getting|got|becomes?|became|starts?|started|picks? up|picked up|clicks?|clicked|opens? up|opened up|comes? together|shines?)'
const EN_ABOUT = '(?:the )?(?:first )?(?:about |around |like |roughly |maybe |~ ?)?'
/** «Затягивает» — перелом, «затягивается» — тянется; второе сюда не берём */
const RU_TURN =
  '(?:становит\\p{L}*|начина\\p{L}*|затягивает|затянул[аи]?|раскрыва\\p{L}*|раскачива\\p{L}*|' +
  'втягива\\p{L}*|разгоня\\p{L}*|цепля\\p{L}*|интересн\\p{L}*|понима\\p{L}*)'
const RU_ABOUT = '(?:перв\\p{L}* )?(?:примерно |где-то |около |почти |буквально )?'

const TTF_RE = [
  `${EN_TURN}(?: ${W_EN}){0,3}? (?:after|around|about|at) ${EN_ABOUT}${QTY}`,
  `after ${EN_ABOUT}${QTY}(?: in)?,?(?: ${W}){0,3}? ${EN_TURN}(?!(?: ${W})? ${EN_BAD})`,
  `(?:the )?first ${QTY} (?:${W} ){0,2}?(?:are|were|is|was|feel|felt|can be|drag|dragged)(?: ${W}){0,2}? (?:slow|boring|tedious|rough|confusing|a tutorial|tutorial|dull|a slog|slog)`,
  `(?:через|после|спустя) ${RU_ABOUT}${QTY}(?: ${W}){0,3}? ${RU_TURN}(?!(?: ${W})? ${RU_BAD})`,
  `${RU_TURN}(?: ${W_RU}){0,3}? (?:через|после|спустя) ${RU_ABOUT}${QTY}`,
  `перв\\p{L}* ${QTY}[ ,:—–-]+(?:${W} ){0,2}?(?:скучн|тягомотн|нудн|обучени|туториал|тяжел|сложн|непонятн|затянут|медленн)\\p{L}*`,
].map((src) => words(src))

function hoursOf(num: string | undefined, hi: string | undefined, unit: string): number | null {
  if (unit === 'полчаса') return num === undefined ? 0.5 : null
  let q: number
  if (num === undefined) {
    // «через час» — единственный случай, где число подразумевается
    if (!unit.startsWith('час')) return null
    q = 1
  } else {
    q = NUM_WORDS[num] ?? Number(num.replace(',', '.'))
  }
  if (hi !== undefined && Number(hi) > q) q = (q + Number(hi)) / 2
  const hours = /^(?:min|мин)/.test(unit) ? q / 60 : q
  return Number.isFinite(hours) && hours > 0 && hours <= MAX_TTF_HOURS ? hours : null
}

/** Первое по тексту упоминание «через N часов становится…»; null — нет такого */
function ttfOf(text: string): number | null {
  let best: { at: number; hours: number } | null = null
  for (const re of TTF_RE) {
    for (const m of text.matchAll(re)) {
      const hours = hoursOf(m[1], m[2], m[3])
      if (hours === null) continue
      const at = m.index ?? 0
      if (!best || at < best.at) best = { at, hours }
      break
    }
  }
  return best ? best.hours : null
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0)

/**
 * Полосы, время до веселья и наигранное по отзывам одной игры. Чистая функция:
 * одинаковый вход — одинаковый выход, без сети и без базы.
 *
 * Вес отзыва — 1 + log1p(votesUp), а не голый log1p: у большинства отзывов
 * ноль голосов, и голый логарифм выкинул бы их из счёта целиком.
 */
export function mineReviews(reviews: readonly RawReview[]): MinedReviews {
  const acc = Object.fromEntries(
    LANES.map((lane) => [lane, { count: 0, weighted: 0, pos: 0, neg: 0 }]),
  ) as Record<Lane, { count: number; weighted: number; pos: number; neg: number }>
  let n = 0
  let nPos = 0
  let nNeg = 0
  let wAll = 0
  let wPos = 0
  let wNeg = 0
  const ttf: number[] = []

  for (const r of reviews) {
    if (r.lang === 'other') continue
    const text = normalizeReviewText(r.text)
    if (!text) continue
    const w = 1 + Math.log1p(r.votesUp)
    n++
    wAll += w
    if (r.votedUp) {
      nPos++
      wPos += w
    } else {
      nNeg++
      wNeg += w
    }
    const hours = ttfOf(text)
    if (hours !== null) ttf.push(hours)
    for (const lane of LANES) {
      // «Через десять часов раскрывается» — медленный старт, даже если ни одно
      // слово из словаря не прозвучало. Полчаса до веселья медленным не считаем.
      const hit = hitsLane(text, LANE_RE[lane]) || (lane === 'slowStart' && hours !== null && hours >= 1)
      if (!hit) continue
      const a = acc[lane]
      a.count++
      a.weighted += w
      if (r.votedUp) a.pos += w
      else a.neg += w
    }
  }

  const lanes = Object.fromEntries(
    LANES.map((lane) => {
      const a = acc[lane]
      const stat: LaneStat = {
        count: a.count,
        weighted: a.weighted,
        share: ratio(a.weighted, wAll),
        sharePos: ratio(a.pos, wPos),
        shareNeg: ratio(a.neg, wNeg),
      }
      return [lane, stat]
    }),
  ) as Record<Lane, LaneStat>

  const pos = reviews.filter((r) => r.votedUp).map((r) => r.playtimeAtReview)
  const neg = reviews.filter((r) => !r.votedUp).map((r) => r.playtimeAtReview)

  return {
    n,
    nPos,
    nNeg,
    lanes,
    timeToFunHours: median(ttf),
    timeToFunMentions: ttf.length,
    playtime: {
      total: reviews.length,
      medianPosMin: median(pos),
      medianNegMin: median(neg),
      negShortShare: neg.length ? neg.filter((m) => m < SHORT_NEG_MIN).length / neg.length : null,
    },
  }
}
