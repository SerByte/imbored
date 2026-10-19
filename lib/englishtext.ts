import { hasCyrillic } from './cyrillic'

/**
 * Годится ли текст из данных для английской версии — одно правило на все
 * двери: описание магазина (lib/gamedesc, lib/catalog), заголовок и тело поста
 * (lib/newspage, ридер /en в lib/db).
 *
 * Отдельным модулем, а не внутри lib/gamedesc: тот тянет наложение пула
 * других магазинов (lib/otherstores), а правило нужно и клиентским островкам
 * ленты (через lib/newspage) — пул им ни к чему. Здесь только hasCyrillic.
 */

/**
 * Служебные слова английского и соседних латинских языков — признак языка,
 * которого буквы не дают: немецкий, испанский или французский текст студии
 * — та же латиница, что и английский. Только слова, которых в английском
 * описании почти не бывает (поэтому нет ни «die», ни «a», ни «in», ни
 * «do»): одно случайное («Los Santos») решения не меняет, см. isEnglishText.
 */
const EN_WORDS = new Set(
  'the and of to you your with for is are on as from this that it its into by or be can all their who will at'.split(' '),
)
const OTHER_WORDS = new Set(
  [
    // немецкий
    'der das und ein eine einen einem einer mit ist nicht für auf dem des zu von sich wie auch oder aus durch wird werden dein deine',
    // французский
    'le les et une du dans pour avec vous votre sur au aux qui ses sont leur cette pas',
    // испанский, португальский, итальянский
    'el los las y del con para por una un es su sus más como lo juego mundo os um uma com em da dos das não seu sua você jogo il gli della di che nel sono gioco',
    // польский, турецкий, нидерландский
    'się jest nie oraz dla gra ve bir ile bu için oyun het een van voor zijn wordt',
  ]
    .join(' ')
    .split(' '),
)

/**
 * Английский ли текст — то, чем /en вправе говорить, а не просто «чем его
 * читать».
 *
 * Не textLang из lib/textlang: там вопрос «каким голосом читать кусок», и
 * латиница против кириллицы его решает. Здесь вопрос «можно ли показать это
 * на английской странице», и у него три отказа, каждый с замера:
 *   1. хоть одна русская буква. «Tom Clancy's Rainbow Six® Siege X —
 *      тактический шутер.» по большинству букв латиница, но это русское
 *      описание, а русского на /en нет (docs/i18n.md);
 *   2. латиница — меньше восьми десятых всех букв. Китайский, японский или
 *      корейский текст студии кириллицы не содержит, а латиница в нём есть
 *      почти всегда («RPG», «Steam», «PvP») — по счёту «латиница против
 *      кириллицы» он выходил английским;
 *   3. служебных слов соседних латинских языков больше, чем английских, и
 *      их хотя бы два: немецкий и испанский текст — та же латиница.
 * Текст без единой буквы («1.0.3») описанием не считается.
 */
export function isEnglishText(text: string | null | undefined): boolean {
  const t = text?.trim()
  if (!t || hasCyrillic(t)) return false
  const letters = t.match(/\p{L}/gu)?.length ?? 0
  if (!letters) return false
  const latin = t.match(/\p{Script=Latin}/gu)?.length ?? 0
  if (latin / letters < 0.8) return false
  let en = 0
  let other = 0
  for (const w of t.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (EN_WORDS.has(w)) en++
    else if (OTHER_WORDS.has(w)) other++
  }
  return !(other >= 2 && other > en)
}
