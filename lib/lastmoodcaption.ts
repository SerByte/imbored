import { freshLastMood, lastMoodStore, nowSecond, type LastMood } from './lastmood'
import { moodCaption } from './quiz'

/**
 * Подпись прошлого настроения — та же строка, которой кончается квиз:
 * «Пара часов · Расслабиться · Один». Пустая, когда помнить нечего или оно
 * протухло: кнопка тогда ведёт в квиз, и подписывать её нечем.
 *
 * Нужна главной. Кнопка вошедшего ведёт сразу в выдачу под прошлое
 * настроение, и молча подменять квиз нельзя — см. докблок lib/lastmood.ts:
 * «30 минут до сна» в субботу днём должно быть видно до нажатия, а не после.
 *
 * ОТДЕЛЬНЫМ МОДУЛЕМ — ради веса каждой страницы. Подпись собирает
 * moodCaption из lib/quiz, а с ним едет весь квиз с текстами вопросов
 * (STEPS, 1.2 КБ кириллицы). Пока подпись жила в lib/lastmood, квиз ехал туда
 * же, куда lastmood: в «Подобрать» шапки и нижней панели (components/PickLink),
 * то есть в первую загрузку КАЖДОЙ страницы. Turbopack вычищает
 * неиспользуемое по модулю на всё приложение, а не по маршруту, — экспорт,
 * нужный одной главной, оставлял квиз всем. Сторож — lib/sharedchunk.test.ts.
 */
export function lastMoodCaption(last: LastMood | null, nowSec: number): string {
  const fresh = freshLastMood(last, nowSec)
  return fresh ? moodCaption(fresh.mood) : ''
}

/*
 * Снимки для useSyncExternalStore — как у pickHrefNow в lib/lastmood: готовая
 * строка, часы читаются в снимке. Серверный снимок — пустая подпись: на
 * сервере устройства нет, и разметка до гидратации обязана совпасть с первым
 * рендером клиента.
 */
export const lastMoodCaptionNow = (): string => lastMoodCaption(lastMoodStore.get(), nowSecond())
export const lastMoodCaptionServer = (): string => ''
