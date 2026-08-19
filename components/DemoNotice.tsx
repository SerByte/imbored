'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Постоянная отметка «библиотека не твоя».
 *
 * Появилась вместе с автодемо: гость, дошедший до конца квиза, больше не
 * улетает на лендинг, а получает настоящую выдачу — но собранную по чужим
 * двадцати двум играм. Без явной подписи это ровно та сделка, от которой
 * продукт уже отказывался (см. докблок app/api/quiz/covers/route.ts про чужие
 * обложки), только ценой не картинка, а сама рекомендация.
 *
 * Поэтому плашка не закрывается и не исчезает по таймеру. Она стоит статично в
 * потоке, а не плавает поверх, как WarmStrip: тот сообщает о временной фоновой
 * работе и обязан уйти, а этот факт верен всё время, пока человек смотрит на
 * выдачу, и на нижнюю панель телефона не претендует.
 *
 * next — текущий адрес целиком, вместе со строкой запроса: в ней лежит
 * настроение, и вернуться человек должен к своей выдаче, а не к анкете.
 */
export function DemoNotice({ variant = 'flow' }: { variant?: 'flow' | 'overlay' }) {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const next = encodeURIComponent(search ? `${pathname}?${search}` : pathname)

  /*
   * Две раскладки под две вёрстки, а не два компонента: текст, ссылка и адрес
   * возврата у них общие, и разъехаться они не должны.
   *
   * 'flow' — обычный поток (/play): выдача начинается ниже шапки, плашке есть
   * куда встать. 'overlay' — поверх полноэкранного героя (/daily), где вставка
   * в поток отрезала бы у него высоту и сломала бы full-bleed. Отступ сверху
   * повторяет высоту фиксированной шапки.
   */
  const wrapper =
    variant === 'overlay'
      ? 'absolute inset-x-0 top-0 z-20 mx-auto w-full max-w-3xl px-5 pt-20 md:pt-24'
      : 'mx-auto w-full max-w-3xl px-5 pt-20 md:pt-24'

  return (
    <div className={wrapper}>
      <div className="glass rounded-[14px] px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <span className="text-dim">
          Это <span className="text-ink">демо-библиотека</span> — игры не твои, подбор настоящий.
        </span>
        <Link
          href={`/api/auth/steam?next=${next}`}
          className="text-ember-text hover:underline shrink-0"
        >
          Подключить свою →
        </Link>
      </div>
    </div>
  )
}
