import { isNeedSteam, writerStore } from '@/lib/writer'

/**
 * СНЯТЬ «ЗАШЛО» — С ПОЛКИ /library И ТЕМ ЖЕ НАЖАТИЕМ У ГЕРОЯ /play И /daily.
 *
 * Сердце у героя — тумблер (aria-pressed), но второе нажатие раньше ничего
 * не делало: ошибочное «Зашло» забиралось только с полки на /library, куда
 * за ним никто не пойдёт, — а подбор тем временем поднимал похожее и снимал
 * паузу после «не то» (lib/recommend). Теперь кнопка снимает его там же,
 * где поставили.
 *
 * Запись — тот же /api/unlike, что у полки (components/LikedShelf), и тот же
 * смысл: DELETE всех строк liked этой игры, остальное — скипы, запуски, бан
 * и ответ на «как тебе?» в outcomes — на месте (unlikeGame в lib/db). Нового
 * действия для отмены не заводится: «зашло» и есть строки liked, и снять его
 * значит убрать их, а не дописать маркер, который пришлось бы учитывать
 * везде, где читают вкус.
 *
 * Модуль клиентский: только fetch и lib/writer, без lib/db. /daily и
 * /library берут его сразу, а /play — ленивым куском героя
 * (components/HeroTail): там первая загрузка у самого потолка бюджета.
 */

/** Последняя запись по игре — следующая встаёт за ней (inTurn) */
const turns = new Map<number, Promise<unknown>>()

/**
 * Записи «Зашло» и его снятия одной игры — строго в порядке нажатий.
 *
 * «Зашло» уходит без ожидания, как все учебные сигналы, и второе нажатие
 * через полсекунды отправило бы /api/unlike, пока вставка ещё едет. Это два
 * запроса и две функции: DELETE мог лечь в базу раньше INSERT — снимать
 * было бы нечего, а следом вставка записала бы «зашло», которое на экране
 * уже снято. Обратная гонка та же: снять и сразу нажать снова — и
 * запоздалый DELETE стёр бы новую вставку. Поэтому запись ждёт предыдущую
 * по той же игре, удачную или нет; разные игры друг друга не ждут.
 */
export function inTurn<T>(appid: number, send: () => Promise<T>): Promise<T> {
  const next = Promise.resolve(turns.get(appid)).then(send, send)
  turns.set(appid, next)
  return next
}

/**
 * /api/unlike в очереди записей этой игры. Промис не отклоняется.
 *
 * needsteam переводит страницу в режим чтения (writerStore — его читают
 * /play и /daily): «нажми ещё раз» тому, у кого не получится никогда, — та
 * же ошибка, что у бана (sendFeedback на /play).
 */
export function sendUnlike(appid: number): Promise<'ok' | 'needsteam' | 'fail'> {
  return inTurn(appid, async () => {
    try {
      const res = await fetch('/api/unlike', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appid }),
      })
      if (await isNeedSteam(res)) {
        writerStore.set(false)
        return 'needsteam'
      }
      return res.ok ? 'ok' : 'fail'
    } catch {
      return 'fail'
    }
  })
}

/** Строка отказа под героем: какая игра и что делать — карточка на месте */
export const unlikeMiss = (name: string) => `Не вышло снять «Зашло» с «${name}» — нажми ещё раз.`

/**
 * Второе нажатие «Зашло» у героя /play и /daily.
 *
 * Кнопка гаснет сразу, сервер узнаёт следом — как и при самом «Зашло». Сбой
 * зажигает её обратно и говорит строкой под героем (say), с какой игры не
 * снялось: пока ответ ехал, герой мог смениться. needsteam тоже зажигает —
 * на сервере оценка осталась, — но молча: кнопку уже спрятал режим чтения,
 * и на её месте строка о входе через Steam.
 *
 * Прежний отказ гаснет до запроса: второй такой же сбой — тот же текст, и
 * без паузы строка промолчала бы (lib/liveregion.test.ts, REPEAT).
 */
export async function undoLike(
  { appid, name }: { appid: number; name: string },
  setLiked: (update: (prev: Set<number>) => Set<number>) => void,
  say: (line: string | null) => void,
): Promise<void> {
  say(null)
  setLiked((prev) => {
    const next = new Set(prev)
    next.delete(appid)
    return next
  })
  const res = await sendUnlike(appid)
  if (res === 'ok') return
  setLiked((prev) => new Set(prev).add(appid))
  if (res === 'fail') say(unlikeMiss(name))
}
