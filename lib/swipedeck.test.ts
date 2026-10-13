import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SwipeDeck, type DeckCard } from '../components/SwipeDeck'

/**
 * Улетающая карта колоды уходит из потока, а не толкает стопку.
 *
 * AnimatePresence у колоды — mode="popLayout": карта, по которой проголосовали,
 * на время вылета (220 мс) становится absolute на своём же месте, и следующая
 * встаёт в поток сразу. Для этого PopChild клонирует ребёнка с ref и по нему
 * меряет и вынимает узел. Ребёнок — TopCard, а не m.div: в React 19 ref
 * приходит компоненту обычным пропом, и TopCard его молча терял. popLayout
 * не делал ничего — замер на 390×844: на вылете стопка занимала 278–709 и
 * 709–1140, новая карта стояла под улетающей, а полоса прогресса и всё под
 * колодой прыгали вниз на высоту карты и обратно на каждом голосе — и в
 * /explore, и в комнате.
 *
 * Браузера здесь нет, поэтому проверяется то звено, которое рвалось: ref,
 * который PopChild отдаёт TopCard, доезжает до m.div карты. m.div подменён
 * записывающей обёрткой — серверный рендер ref не вызывает, но проп видит.
 */

const seen = vi.hoisted(() => ({ divs: [] as { className: string; ref: unknown }[] }))

vi.mock('framer-motion', async (importOriginal) => {
  const fm = await importOriginal<typeof import('framer-motion')>()
  const { createElement: h } = await import('react')
  const Div = fm.m.div
  function RecordingDiv(props: Record<string, unknown>) {
    seen.divs.push({ className: String(props.className ?? ''), ref: props.ref })
    return h(Div, props)
  }
  return {
    ...fm,
    m: new Proxy(fm.m, { get: (target, key) => (key === 'div' ? RecordingDiv : Reflect.get(target, key)) }),
  }
})

const card = (appid: number): DeckCard => ({
  appid,
  name: `Игра ${appid}`,
  ownedByAll: true,
  missingFor: [],
  headerImage: null,
  tags: ['Roguelike'],
})

beforeEach(() => {
  seen.divs = []
})

describe('колода: улетающая карта не толкает стопку', () => {
  test('ref от AnimatePresence (popLayout) доезжает до узла верхней карты', () => {
    renderToStaticMarkup(
      createElement(SwipeDeck, {
        cards: [card(10), card(20), card(30)],
        onVote: () => {},
        votedCount: 0,
        deckTotal: 3,
        nowSec: 1_760_000_000,
      }),
    )
    // верхняя карта — deck-card без deck-back: задние карты стопки — только глубина
    const top = seen.divs.filter((d) => /\bdeck-card\b/.test(d.className) && !/\bdeck-back\b/.test(d.className))
    expect(top, 'верхняя карта не найдена — сторож ослеп').toHaveLength(1)
    expect(
      typeof top[0].ref,
      'без ref popLayout не вынимает улетающую карту из потока — стопка на вылете вдвое выше',
    ).toBe('function')
  })

  /*
   * Вынутая из потока карта ложится туда же, где встаёт следующая, а в DOM
   * стоит перед ней: AnimatePresence держит уходящего ребёнка на прежнем
   * индексе. При равном z-index позиционированные рисуются в порядке
   * разметки — проголосованная карта уезжала бы ПОД проступающую новую.
   * Уход — состояние клиента после голоса, серверным рендером его не
   * получить, поэтому здесь — разметка TopCard.
   */
  test('улетающая карта рисуется поверх следующей, присутствующая — нет', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'SwipeDeck.tsx'), 'utf8')
    const top = src.slice(src.indexOf('function TopCard('), src.indexOf('export function SwipeDeck('))
    expect(top, 'TopCard не найден — сторож ослеп').not.toBe('')
    expect(top).toMatch(/const present = useIsPresent\(\)/)
    expect(top).toContain("className={`deck-card media-card relative touch-pan-y${present ? '' : ' z-10'}`}")
  })
})
