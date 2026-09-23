import { plural } from './plural'

/**
 * КТО ЧИТАЕТ ПОРТРЕТ — ОТ ЭТОГО ЗАВИСИТ, КАК ОН ГОВОРИТ.
 *
 * Портрет — страница, которую отправляют: её открывает не только владелец, но
 * и друг по ссылке из чата. А говорила она со всеми одинаково, на «ты»: над
 * ником «Аня» друг читал «80% твоей игровой жизни — это 3 игры», «ты однолюб»
 * и «Если решишься — начни с этой» с игрой из Аниной библиотеки, которой у
 * него нет. Было непонятно, про кого страница.
 *
 * Поэтому у каждой фразы два голоса. 'you' — владельцу, как было. 'them' —
 * гостю: нейтрально или в третьем лице. Нейтрально, а не «Аня провела»: пол
 * по нику не узнать, а «провёл(а)» на странице, которой хвастаются, хуже
 * безличного «сыграно».
 *
 * Модуль без зависимостей, кроме plural: страница серверная, а формы здесь —
 * чтобы их можно было проверить тестом на всех числах, а не на одном из
 * демо-библиотеки.
 */
export type PortraitVoice = 'you' | 'them'

export type PortraitFacts = {
  gamesCount: number
  totalHours: number
  unplayedCount: number
  topGame: { name: string; sharePercent: number } | null
}

/** Начало фразы про 80% времени: «… — это N игр из M» */
export function paretoLead(voice: PortraitVoice): string {
  return voice === 'you' ? '80% твоей игровой жизни — это' : '80% игровой жизни — это'
}

/** Вывод после «Концентрация N из 100:» — три ступени, как и раньше */
export function concentrationVerdict(concentration: number, voice: PortraitVoice): string {
  if (concentration >= 50) {
    return voice === 'you' ? 'ты однолюб и не скрываешь этого' : 'однолюб и не скрывает этого'
  }
  if (concentration >= 20) {
    return voice === 'you'
      ? 'есть любимцы, но ты не заперт в одной игре'
      : 'есть любимцы, но без привязки к одной игре'
  }
  return voice === 'you'
    ? 'ты размазан ровным слоем по всей библиотеке'
    : 'время размазано ровным слоем по всей библиотеке'
}

/** Хвост после «N%»: доля часов не в одиночку */
export function socialTail(voice: PortraitVoice): string {
  return voice === 'you' ? 'часов ты провёл не один.' : 'часов сыграно не в одиночку.'
}

/** Заголовок полки нераспакованного после числа: «12 игр ты так и не запустил» */
export function unplayedHeading(n: number, voice: PortraitVoice): string {
  return voice === 'you'
    ? `${plural(n, 'игра', 'игры', 'игр')} ты так и не запустил`
    : plural(n, 'игра так и не запущена', 'игры так и не запущены', 'игр так и не запущено')
}

/** Начало фразы про эпоху библиотеки: «… — 2016, а самая старая…» */
export function eraLead(voice: PortraitVoice): string {
  return voice === 'you' ? 'Медиана твоей библиотеки —' : 'Медиана библиотеки —'
}

/**
 * Запасной текст портрета — когда модель недоступна или потолок исчерпан.
 *
 * Текст модели пишется владельцу и кэшируется на снапшот, его голос не
 * выбрать; гостю страница показывает его цитатой «imbored о {name}». Этот же
 * собирается на каждый заход, и у него голос есть: гостю — о владельце, а не
 * к нему.
 */
export function portraitFallbackText(
  name: string,
  archetypes: Array<{ label: string; percent: number }>,
  facts: PortraitFacts,
  voice: PortraitVoice,
): string {
  const you = voice === 'you'
  const parts: string[] = []
  if (archetypes.length >= 2) {
    const [a, b] = archetypes
    parts.push(
      you
        ? `${name}, ты на ${a.percent}% ${a.label} и на ${b.percent}% ${b.label}.`
        : `${name} на ${a.percent}% ${a.label} и на ${b.percent}% ${b.label}.`,
    )
  }
  const hours = `${facts.totalHours.toLocaleString('ru-RU')} ${plural(facts.totalHours, 'час', 'часа', 'часов')}`
  const games = `${facts.gamesCount} ${plural(facts.gamesCount, 'игре', 'играх', 'играх')}`
  const unplayed = facts.unplayedCount
    ? you
      ? `, а ${facts.unplayedCount} ${plural(facts.unplayedCount, 'игру', 'игры', 'игр')} ты так и не распаковал`
      : `, а ${facts.unplayedCount} ${plural(facts.unplayedCount, 'игра так и не распакована', 'игры так и не распакованы', 'игр так и не распаковано')}`
    : ''
  parts.push(`За плечами ${hours} в ${games}${unplayed}.`)
  if (facts.topGame && facts.topGame.sharePercent >= 30) {
    parts.push(
      you
        ? `«${facts.topGame.name}» забрала ${facts.topGame.sharePercent}% всей твоей игровой жизни — и, кажется, не собирается отдавать.`
        : `«${facts.topGame.name}» забрала ${facts.topGame.sharePercent}% всей игровой жизни — и, кажется, не собирается отдавать.`,
    )
  }
  return parts.join(' ')
}
