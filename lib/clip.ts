/**
 * Обрезка текста для meta description — одна на карточку игры и страницу
 * патча. Жила внутри lib/gamepage, пока потребитель был один; вынесена сюда,
 * потому что тот модуль тянет за собой базу, а описание патча собирается
 * чистой функцией (lib/newspage).
 *
 * Модуль без импортов.
 */

/**
 * Сколько описания показывает выдача. Дальше Google и Яндекс режут сами — и
 * режут посреди слова: «…brandish the power of the Elden» стояло в сниппете
 * Elden Ring.
 */
export const DESCRIPTION_MAX = 155

/**
 * Обрезка по слову с многоточием. null — когда в место не влезает и одного
 * слова: обрубок хуже отсутствия.
 *
 * Целое предложение лучше начала следующего: «ролевая игра.» читается как
 * законченная мысль, «ролевая игра. Восстань…» — как оборванная. Но только если
 * предложение занимает хотя бы половину места: иначе отдали бы полстроки ради
 * точки.
 */
export function clip(text: string, max: number): string | null {
  if (text.length <= max) return text
  if (max < 2) return null
  const whole = text.slice(0, max + 1).match(/^[\s\S]*[.!?](?=\s)/)?.[0]
  if (whole && whole.length >= max / 2) return whole
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  if (space <= 0) return null
  return `${cut.slice(0, space).replace(/[\s.,;:!?…—–-]+$/, '')}…`
}
