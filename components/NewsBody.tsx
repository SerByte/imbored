import { stripBbcode, type Inline, type NewsBlock } from '@/lib/steamhtml'
import { linkLabel } from '@/lib/linklabel'

/**
 * Рендер тела патчноута. Серверный, без единой строчки JS на клиенте.
 *
 * На вход идёт уже разобранное дерево блоков, а не HTML: разметку издателя мы
 * не вставляем в страницу ни в каком виде, поэтому dangerouslySetInnerHTML тут
 * нет и не должно появиться. Текст экранирует React сам.
 *
 * stripBbcode здесь — не дубль защиты из парсера, а покрытие УЖЕ ЗАПИСАННЫХ
 * блоков: дерево лежит в базе разобранным, и правка парсера дойдёт до старых
 * записей только со следующим опросом ленты. До тех пор чистит показ.
 *
 * linkLabel правит только ВИДИМЫЙ текст ссылки; href не трогается никогда.
 * У четверти ссылок в патчнотах подписью стоит сам адрес со схемой и хвостом
 * параметров — см. докблок там же.
 */

function Runs({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((r, i) => {
        if (r.href) {
          return (
            <a
              key={i}
              href={r.href}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="text-ember-text hover:underline underline-offset-2"
            >
              {linkLabel(stripBbcode(r.text), r.href)}
            </a>
          )
        }
        if (r.bold) {
          return (
            <strong key={i} className="text-ink font-semibold">
              {stripBbcode(r.text)}
            </strong>
          )
        }
        return <span key={i}>{stripBbcode(r.text)}</span>
      })}
    </>
  )
}

export function NewsBody({ blocks, className = '' }: { blocks: NewsBlock[]; className?: string }) {
  if (!blocks.length) return null
  return (
    /*
      break-words на корне блока, а не на ссылке. В чужом тексте попадаются
      неразрывные куски длиннее колонки — адреса, версии, идентификаторы, — и
      при overflow-wrap: normal такой кусок просто уезжает за край. Замерено
      на 375 px: подпись ссылки шириной 365 px в колонке 293 вылезала на 72 px
      и обрезалась предком, то есть хвост адреса было не прочитать.
    */
    <div
      className={`flex flex-col gap-3 text-sm leading-relaxed break-words text-dim ${className}`}
    >
      {blocks.map((b, i) => {
        if (b.kind === 'h') {
          /*
           * Заголовок ВНУТРИ чужого текста, а не подпись раздела продукта.
           *
           * Стоял он в верхнем регистре с разрядкой — то есть ровно в той
           * форме, которой в этом интерфейсе говорит сам сервис (Eyebrow,
           * см. components/Labels.tsx). Получалось, что «ОРУЖИЕ» из
           * патчноута Valve выглядит так же, как «ЗАПЕЧАТАННОЕ» и
           * «ЧИСТИЛИЩЕ», которые пишем мы. Голос издателя не должен быть
           * неотличим от нашего.
           *
           * Поэтому обычный подзаголовок: тот же кегль, что у тела, но
           * основным цветом и полужирным. Внутри приглушённого текста этого
           * достаточно, чтобы читаться заголовком, и ничего не занимает у
           * словаря продукта.
           */
          return (
            <h3 key={i} className="mt-2 text-sm font-semibold text-ink">
              {stripBbcode(b.text)}
            </h3>
          )
        }
        if (b.kind === 'ul') {
          return (
            <ul key={i} className="flex flex-col gap-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  {/* точка, а не маркер списка: у Steam пункты бывают в
                      несколько строк, и висячий отступ читается лучше */}
                  <span aria-hidden className="mt-[7px] size-1 rounded-full bg-ember shrink-0" />
                  <span>
                    <Runs runs={item} />
                  </span>
                </li>
              ))}
            </ul>
          )
        }
        if (b.kind === 'img') {
          // next/image тут не подходит: адреса произвольные с CDN Steam, под
          // них пришлось бы открывать remotePatterns на весь домен. Хост уже
          // проверен при разборе (lib/steamhtml), картинка ленивая.
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={b.src}
              alt=""
              loading="lazy"
              className="rounded-[14px] border border-edge max-w-full h-auto"
            />
          )
        }
        return (
          <p key={i}>
            <Runs runs={b.runs} />
          </p>
        )
      })}
    </div>
  )
}
