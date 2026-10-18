import { revalidatePath } from 'next/cache'
import { routePaths } from './i18n'

/**
 * revalidatePath для адреса сайта — обе языковые копии разом.
 *
 * Страницы живут в app/[lang]/…, и ISR кэширует их по пути маршрута: /ru/game/730
 * и /en/game/730, а не по /game/730 из строки браузера (русский адрес доезжает
 * туда rewrite'ом, см. routePaths в lib/i18n.ts). Голый revalidatePath('/game/730')
 * больше ничего не сбрасывает — и молча: ни ошибки, ни предупреждения. Так
 * «Удалить всё обо мне» оставило бы в кэше карточку портрета с ником, а крон
 * карточек — обещание погасшей скидки в JSON-LD.
 *
 * Тот же контракт, что у revalidatePath: путь — адрес без языка, как его
 * строят gamePagePath, forgetCardPaths и roomCardPath. Вне сервера Next
 * бросает так же, поэтому вызывающие по-прежнему принимают его аргументом.
 */
export function revalidateSitePath(path: string): void {
  for (const p of routePaths(path)) revalidatePath(p)
}
