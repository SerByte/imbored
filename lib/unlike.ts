import type { FeedbackCtx } from '@/lib/feedbackctx'
import { LIKE_ROWS_KEY } from '@/lib/planforget'
import type { Mood } from '@/lib/types'
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
 * Запись — тот же /api/unlike, что у полки (components/LikedShelf), но
 * снимают они разное. Полка показывает то, что помнит сервер (listLiked), и
 * снимает всё «зашло» игры. Сердце героя — состояние экрана: оно гаснет с
 * каждой выдачей, и игра, которой «Зашло» сказали на прошлой неделе, приходит
 * героем с пустым сердцем. Снятие всего стирало бы и то, прежнее: нажал по
 * ошибке, снял — сердце как до нажатий, а игра молча ушла с полки и из
 * вкуса. Поэтому сердце снимает ровно строку, которую легло его «Зашло»
 * (row в ответе /api/feedback, sendLike ниже), и ничего, если не легло
 * ничего: суточный повтор дедуп проглатывает (lib/db), и снимать тогда
 * нечего — прежнее «зашло» остаётся, как было до нажатий. Кроме одного
 * случая: снятие этого сердца сорвалось, и его строка жива, — тогда дедуп
 * проглотил новое «Зашло» в неё же, и снимать следующему нажатию её
 * (unsure ниже). Остальное — скипы, запуски, бан и ответ на «как тебе?» в
 * outcomes — на месте (unlikeGame в lib/db). Нового действия для отмены не заводится: «зашло» и
 * есть строки liked, и снять его значит убрать строку, а не дописать маркер,
 * который пришлось бы учитывать везде, где читают вкус.
 *
 * Модуль клиентский: только fetch, lib/writer и ключ хранилища из
 * lib/planforget, без lib/db. /daily, /library и /explore (очередь записей,
 * inTurn) берут его сразу, а /play — ленивым куском героя
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
 *
 * Той же очередью ходят свайпы колоды /explore и «Убрать» с её полки: там
 * правда — последний свайп игры, и «Мимо» → «Вернуть» → «Интересно» за
 * секунду иначе могли лечь в базу в обратном порядке.
 */
export function inTurn<T>(appid: number, send: () => Promise<T>): Promise<T> {
  const next = Promise.resolve(turns.get(appid)).then(send, send)
  turns.set(appid, next)
  return next
}

/** Чьё сердце: героя /play или героя /daily */
export type Heart = 'play' | 'daily'

/**
 * Сколько строк помнить. Запись растёт с каждым «Зашло», которое не сняли,
 * а нужна только та, что горит сейчас: у /play это пятёрка, у /daily —
 * герой и своя. Полсотни — с запасом на вечер, и старшие уходят первыми.
 */
const ROWS_MAX = 50

/**
 * Строки, которые легли от сердца в этой вкладке: «play:620» → id. Нет
 * ключа — снимать этому сердцу нечего.
 *
 * Своя память у каждого сердца, а не одна на игру. «Зашло» у героя /play,
 * потом то же у /daily — второе дедуп проглотит, и общая запись «последнее
 * нажатие ничего не вставило» оставила бы горящему сердцу /play (выдача на
 * устройстве его помнит, lib/playcache) пустое снятие, а его «зашло» — на
 * сервере.
 *
 * В sessionStorage, а не только в памяти: сердце /play переживает
 * перезагрузку вкладки вместе с выдачей — телефон, выгрузивший вкладку, пока
 * открыт Steam, — и снять его после неё надо той же строкой. Хранилище не
 * читается (приватный режим) — память модуля: до перезагрузки её хватает.
 * Выход стирает запись вместе с выдачей (lib/playforget).
 */
let memory: Record<string, number> = {}

/**
 * Сердца, чьё последнее снятие сорвалось: «play:620». Их строка на сервере
 * жива (снять не вышло), а в записи выше — помнится.
 *
 * Без этой отметки «Зашло» следом за таким снятием теряло бы её. Сердце
 * гасят и, пока /api/unlike едет, жмут снова: новое «Зашло» встаёт в
 * очередь за снятием. Снятие падает, а откат undoLike молчит — слово за
 * вставкой. Вставку же на сервере проглатывает дедуп: прежняя строка
 * осталась, скипа с тех пор не было, — и /api/feedback отвечает row: null.
 * Запиши sendLike это как «ничего не легло» — и забыл бы ту самую живую
 * строку: следующее снятие гасило бы сердце без запроса, а «зашло» молча
 * оставалось на полке и во вкусе. Здесь дедуп проглотил «Зашло» не в чужое
 * прежнее, а в строку этого же сердца, и снимать следующему нажатию её.
 *
 * Только память модуля, без хранилища: окно — от сорванного снятия до
 * следующего «Зашло», секунды. Перезагрузка между ними оставляет сердце
 * горящим (откат) со строкой в записи — снимется той же.
 */
const unsure = new Set<string>()

function readRows(): Record<string, number> {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(LIKE_ROWS_KEY)
  } catch {
    return { ...memory }
  }
  try {
    const rec: unknown = raw === null ? {} : JSON.parse(raw)
    // Пишет туда кто угодно: только id строк, остальное — мимо
    return Object.fromEntries(
      Object.entries(rec ?? {}).filter((e): e is [string, number] => Number.isSafeInteger(e[1]) && e[1] > 0),
    )
  } catch {
    return {}
  }
}

/** Запомнить, что легло от нажатия этого сердца; null — ничего не легло. Не бросает */
function remember(heart: Heart, appid: number, row: number | null): void {
  const key = `${heart}:${appid}`
  const rows = readRows()
  delete rows[key]
  if (row !== null) rows[key] = row
  // Ключи не числовые — порядок вставки, и старшие стоят первыми
  const keys = Object.keys(rows)
  for (const k of keys.slice(0, Math.max(0, keys.length - ROWS_MAX))) delete rows[k]
  memory = rows
  try {
    sessionStorage.setItem(LIKE_ROWS_KEY, JSON.stringify(rows))
  } catch {
    // приватный режим — помнит память модуля
  }
}

/**
 * «Зашло» у героя /play и /daily — в очереди записей игры, со строкой,
 * которую оно легло (row в ответе /api/feedback). Промис не отклоняется:
 * это учебный сигнал, и потерянный по одному человеку не объясняют (докблок
 * sendFeedback на /play).
 *
 * Сбой и needsteam — строки нет, и снимать сердцу нечего. Если вставка всё
 * же легла, а ответ потерялся, «зашло» останется и сердцем его не снять —
 * только с полки /library. Это честнее обратного: снять вслепую значило бы
 * снять и прежние.
 *
 * Исключение — сердце, чьё снятие только что сорвалось (unsure выше): его
 * строка жива, и «ничего не легло» значит «легло в неё» — запись её
 * сохраняет. Сбой самого «Зашло» тут же: строка та жива всё равно, и
 * горящее сердце должно уметь её снять. Новая строка — отметка снимается:
 * прежнюю, значит, всё-таки удалили, и помнить надо уже новую.
 */
export function sendLike(heart: Heart, appid: number, body: { mood?: Mood; ctx: FeedbackCtx }): Promise<void> {
  // Сессия только читает — ответ известен заранее (как у sendFeedback /play)
  if (writerStore.get() === false) return Promise.resolve()
  return inTurn(appid, async () => {
    let row: number | null = null
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appid, action: 'liked', ...body }),
      })
      if (await isNeedSteam(res)) writerStore.set(false)
      else if (res.ok) {
        const got = ((await res.json()) as { row?: unknown }).row
        row = Number.isSafeInteger(got) && (got as number) > 0 ? (got as number) : null
      }
    } catch {
      // сеть или не JSON — строки нет
    }
    const key = `${heart}:${appid}`
    if (row !== null) unsure.delete(key)
    else if (unsure.has(key)) return
    remember(heart, appid, row)
  })
}

/**
 * /api/unlike в очереди записей этой игры. Промис не отклоняется.
 *
 * Без heart — полка /library: снимается всё «зашло» игры. С heart — сердце
 * героя: только строка, которую легло его нажатие (sendLike выше). Её
 * читают уже в очереди — за вставкой, которая её и приносит. Нет строки —
 * снимать нечего, и запроса нет: 'ok' сразу. Удачное снятие строку
 * забывает, неудачное — помнит: «нажми ещё раз» снимет ту же. И отмечает
 * сердце (unsure): «Зашло» следом, проглоченное дедупом, эту строку не
 * сотрёт.
 *
 * needsteam переводит страницу в режим чтения (writerStore — его читают
 * /play и /daily): «нажми ещё раз» тому, у кого не получится никогда, — та
 * же ошибка, что у бана (sendFeedback на /play).
 */
export function sendUnlike(appid: number, heart?: Heart): Promise<'ok' | 'needsteam' | 'fail'> {
  return inTurn(appid, async () => {
    const key = `${heart}:${appid}`
    const row = heart ? readRows()[key] : undefined
    if (heart && row === undefined) return 'ok'
    const res = await unlikeRequest(appid, row)
    if (!heart) return res
    if (res === 'ok') {
      unsure.delete(key)
      remember(heart, appid, null)
    } else unsure.add(key)
    return res
  })
}

/** Сам запрос /api/unlike: без row — всё «зашло» игры, с ним — одна строка */
async function unlikeRequest(appid: number, row: number | undefined): Promise<'ok' | 'needsteam' | 'fail'> {
  try {
    const res = await fetch('/api/unlike', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(row === undefined ? { appid } : { appid, row }),
    })
    if (await isNeedSteam(res)) {
      writerStore.set(false)
      return 'needsteam'
    }
    return res.ok ? 'ok' : 'fail'
  } catch {
    return 'fail'
  }
}

/** Строка отказа под героем: какая игра и что делать — карточка на месте */
export const unlikeMiss = (name: string) => `Не вышло снять «Зашло» с «${name}» — нажми ещё раз.`

/**
 * Второе нажатие «Зашло» у героя /play и /daily: снимает строку, которую
 * легло первое (sendUnlike с heart), и только её.
 *
 * Кнопка гаснет сразу, сервер узнаёт следом — как и при самом «Зашло». Сбой
 * зажигает её обратно и говорит строкой под героем (say), с какой игры не
 * снялось: пока ответ ехал, герой мог смениться. needsteam тоже зажигает —
 * на сервере оценка осталась, — но молча: кнопку уже спрятал режим чтения,
 * и на её месте строка о входе через Steam.
 *
 * Прежний отказ гаснет до запроса: второй такой же сбой — тот же текст, и
 * без паузы строка промолчала бы (lib/liveregion.test.ts, REPEAT).
 *
 * Откат — только если за снятием по этой игре ничего не встало в очередь.
 * Пока /api/unlike ехал, сердце могли нажать снова: оно зажглось, и новое
 * «Зашло» ждёт в inTurn за снятием. Сбой снятия тогда уже ничего не решает —
 * последним скажет вставка, и на сервере, и на экране (строку, которую
 * снять не вышло и в которую её проглотит дедуп, сердце помнит: unsure
 * выше), — а строка «нажми ещё раз» под горящим сердцем звала бы снять то,
 * что человек только что поставил. Обратный случай тот же: снял, зажёг,
 * снова снял — откат первого зажёг бы сердце, которое последнее нажатие
 * погасило. Очередь хранит последнюю запись игры, и промис sendUnlike — та
 * самая запись: не она последняя — значит, после неё нажимали, и слово за
 * тем нажатием.
 */
export async function undoLike(
  heart: Heart,
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
  const sent = sendUnlike(appid, heart)
  const res = await sent
  if (res === 'ok' || turns.get(appid) !== sent) return
  setLiked((prev) => new Set(prev).add(appid))
  if (res === 'fail') say(unlikeMiss(name))
}
