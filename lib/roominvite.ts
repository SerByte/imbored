import type { GameArtUrls } from './art'
import { plural } from './plural'

/**
 * Что известно о комнате тому, кто ещё в неё не вошёл, — и что из этого
 * сказать в превью.
 *
 * Тексты живут здесь, а не в layout и opengraph-image комнаты: заголовок
 * страницы и карточка в чате обязаны говорить одно и то же, а по отдельности
 * они разъезжались уже на второй правке. Заодно здесь их можно проверить
 * тестом — роуты тянут базу и next/og.
 */

export type RoomInvite = {
  id: string
  /** сколько человек уже в комнате */
  members: number
  /** ник создателя, если Steam его отдал */
  host: string | null
  /** матч уже случился — приглашать больше некуда */
  matched: boolean
  /** на чём сошлись; null — матча нет или игры нет в каталоге */
  matchedName: string | null
  /**
   * Арт сошедшейся игры — фон карточки после матча. Необязательное поле:
   * заголовку страницы оно не нужно, только картинке.
   */
  matchedArt?: { appid: number; art: GameArtUrls | null; headerImage: string | null } | null
}

export type InviteCopy = {
  /** <title>, og:title и twitter:title */
  title: string
  /** meta и og:description */
  description: string
  /** надзаголовок карточки, моноширинным */
  eyebrow: string
  /** крупная строка карточки под кодом */
  headline: string
  /** подвал карточки */
  foot: string
}

/** Куда звать того, кому ссылка досталась после матча. */
export const NEW_ROOM_HINT = 'Собери свою комнату — imbored.cc/room/new'

/** Потолок имени игры в карточке: строка стоит кеглем 44 в ширину 900. */
const CARD_NAME_MAX = 38

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/**
 * Три состояния, и у каждого свой текст.
 *
 * МАТЧ. Статус 'matched' ставится навсегда, а ссылку продолжают пересылать —
 * в другой чат или из истории. Превью звало «подключи библиотеку и свайпай»,
 * хотя свайпать там уже нечего: человек входил и попадал на чужой экран
 * матча. Теперь превью называет игру, на которой сошлись, и зовёт собрать
 * свою комнату.
 *
 * КОМНАТА ЖДЁТ. Приглашение как было: кто зовёт, сколько уже внутри, что
 * делать.
 *
 * НИЧЕГО НЕ ИЗВЕСТНО. Комнаты с таким кодом нет — или база молчит, и
 * loadRoomInvite отдал null. Различить эти случаи здесь нечем, поэтому текст
 * нейтральный: что такое пати, без призыва подключаться и свайпать в
 * комнату, которой, возможно, нет.
 */
export function inviteCopy(code: string, invite: RoomInvite | null): InviteCopy {
  if (!invite) {
    return {
      title: `Пати ${code}`,
      description:
        'Пати на imbored: компания выбирает одну игру на вечер из своих библиотек Steam — голосами, без споров в чате.',
      eyebrow: 'ПАТИ',
      headline: 'Компания выбирает игру на вечер',
      foot: 'Одна игра на всех — из ваших библиотек Steam',
    }
  }

  if (invite.matched) {
    const game = invite.matchedName
    return {
      title: game ? `Пати ${code} сошлась на «${game}»` : `Пати ${code} уже выбрала игру`,
      description:
        // Без точки в конце: часть мессенджеров приклеивает её к адресу
        `Голоса сошлись${game ? ` на «${game}»` : ''} — в этой комнате игра уже выбрана. ${NEW_ROOM_HINT}`,
      eyebrow: 'ПАТИ · МАТЧ',
      headline: game ? `Сошлись на «${clip(game, CARD_NAME_MAX)}»` : 'Игра уже выбрана',
      foot: NEW_ROOM_HINT,
    }
  }

  const inRoom = (words: [string, string, string]) =>
    `${invite.members} ${plural(invite.members, ...words)}`

  return {
    title: invite.host ? `${invite.host} зовёт в пати ${code}` : `Тебя зовут в пати ${code}`,
    description:
      `${inRoom(['человек уже в комнате', 'человека уже в комнате', 'человек уже в комнате'])}. ` +
      'Подключи свою библиотеку Steam и свайпай, во что готов играть: совпадут голоса всех — будет матч.',
    eyebrow: 'ПАТИ · ПРИГЛАШЕНИЕ',
    headline: invite.host
      ? `${invite.host.slice(0, 18)} зовёт выбрать игру на вечер`
      : 'Тебя зовут выбрать игру на вечер',
    foot: `${inRoom(['человек в комнате', 'человека в комнате', 'человек в комнате'])} · подключи библиотеку и свайпай`,
  }
}
