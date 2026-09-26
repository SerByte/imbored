/**
 * Слова заголовка для пословного входа (components/SplitHeading).
 *
 * Режем только по обычным пробелам и переводам строк. Неразрывный пробел
 * (U+00A0) остаётся ВНУТРИ слова — «5\u00a0ч», «Mass\u00a0Effect» не
 * разъедутся по строкам и не въедут по отдельности. \s здесь нельзя: он
 * ловит и nbsp. Прежде это делал SplitText из gsap — ради него ядро gsap и
 * ехало в первую загрузку пяти маршрутов.
 */
export function splitWords(text: string): string[] {
  return text.split(/[ \t\n\r]+/).filter(Boolean)
}
