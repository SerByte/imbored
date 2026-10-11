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
 */
export function matchShareUrl(origin: string, roomId: string): string {
  return withRef(`${origin}/room/${encodeURIComponent(roomId)}`, 'match')
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
 * приглашение.
 */
export function matchShareCopy(args: {
  name: string
  forCount: number | null | undefined
  memberCount: number
}): { title: string; text: string } {
  const title = `Играем в «${args.name}»`
  const text = matchByLeader(args.forCount, args.memberCount)
    ? `${title}: договорились голосами, ${args.forCount} из ${args.memberCount} за`
    : `${title} — голоса всей пати сошлись`
  return { title, text }
}
