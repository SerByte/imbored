import type { QuizCover } from './quizart'

/**
 * Обложка последнего ответа, доезжающая с квиза до экрана ожидания.
 *
 * Почему не адресом. Настроение — контракт между экранами: его читает /play,
 * его валидирует parseMood на сервере, по нему делятся ссылками. Обложка —
 * украшение перехода, и в контракте ей не место; ссылка с чужим appid внутри
 * ещё и обещала бы то, чего не будет.
 *
 * sessionStorage выбран за срок жизни: вкладка закрылась — забыли. Ключ
 * читается ОДИН раз и сразу стирается, иначе прямой заход на /play через час
 * подхватил бы вчерашнюю картинку и соврал бы, что она откуда-то следует.
 *
 * try/catch обязателен: в приватном режиме и при запрещённом хранилище доступ
 * бросает. Тот же защитный приём, что у скрипта темы в корневом layout.
 */

const KEY = 'imbored-quiz-cover'

export function stashQuizCover(cover: QuizCover): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cover))
  } catch {
    // Не доехала картинка — не доехала. Экран ожидания и без неё целый.
  }
}

export function takeQuizCover(): QuizCover | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<QuizCover>
    // Проверяем, а не приводим типом: в хранилище может лежать что угодно,
    // включая мусор от прошлой версии приложения
    if (typeof parsed?.appid !== 'number' || parsed.appid <= 0) return null
    if (typeof parsed.name !== 'string') return null
    return parsed as QuizCover
  } catch {
    return null
  }
}
