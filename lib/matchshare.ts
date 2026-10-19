import { lp, tr, type Locale } from './i18n'
import { matchByLeader } from './room'
import { withRef } from './track'

/*
 * «Поделиться» с экрана матча — адрес и текст.
 *
 * Отдельным модулем, а не рядом с roomShareUrl в lib/roomshare: тот едет в
 * начальном наборе скриптов комнаты, а /room/[id] стоит у самого потолка
 * бюджета (bundle-budget.json). Этот модуль импортирует только кнопка внутри
 * церемонии, и он приезжает её догружаемым куском — тогда же, когда она.
 */

/**
 * Ссылка на сошедшуюся комнату. Адрес тот же, что у приглашения, — открывший
 * её увидит «Эта пати уже договорилась» и дорогу в свою комнату, — а метка
 * своя: ref=match (lib/track). Тот, кто делится, отдаёт только код комнаты,
 * который и так в пути, — не свой адрес со всеми его хвостами.
 *
 * Язык — того, кто делится: весть по-английски уходит английским адресом, и
 * друг, открывший её, читает экран сошедшейся комнаты на том же языке.
 */
export function matchShareUrl(origin: string, roomId: string, locale: Locale = 'ru'): string {
  return withRef(`${origin}${lp(locale, `/room/${encodeURIComponent(roomId)}`)}`, 'match')
}

/**
 * Заголовок и текст для панели «Поделиться». В Telegram и WhatsApp текст
 * ложится в сообщение рядом со ссылкой, поэтому он называет игру сам — не
 * надеясь на заголовок, который часть приложений выбрасывает.
 *
 * Матч лидером голосов — с честным счётом, тем же правилом, что у заголовка
 * церемонии (matchByLeader): «голоса всей пати сошлись» там неправда.
 *
 * Без «заходите»: сошедшаяся комната новых людей не пускает (join отвечает
 * 409 matched), и звать туда — обещать то, чего не будет. Это весть, а не
 * приглашение. По-английски — тоже без «join»; счёт — «3 of 4 said yes»,
 * единогласие — «the whole party said yes»: одна мера на оба случая.
 */
export function matchShareCopy(
  args: {
    name: string
    forCount: number | null | undefined
    memberCount: number
  },
  locale: Locale = 'ru',
): { title: string; text: string } {
  const title = tr(locale, { ru: `Играем в «${args.name}»`, en: `We're playing “${args.name}”` })
  const text = matchByLeader(args.forCount, args.memberCount)
    ? tr(locale, {
        ru: `${title}: договорились голосами, ${args.forCount} из ${args.memberCount} за`,
        en: `${title}: agreed by vote, ${args.forCount} of ${args.memberCount} said yes`,
      })
    : tr(locale, { ru: `${title} — голоса всей пати сошлись`, en: `${title} — the whole party said yes` })
  return { title, text }
}
