'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { settleSessionHint } from '@/lib/sessionhint'
import { claimSessionTouch, forgetSessionTouch } from '@/lib/sessiontouch'
import { writerFrom, writerStore } from '@/lib/writer'

/**
 * Продлевает вход, пока человек пользуется сайтом.
 *
 * Зачем вообще нужен: серверные страницы куку переставить не могут (HTTP не
 * разрешает Set-Cookie после начала стрима), поэтому продление живёт в роуте,
 * а позвать роут должен кто-то с клиента. Вот этот кто-то.
 *
 * Отметка «уже дёргали» — одна на вкладку и общая с главной, которая зовёт
 * touch сама: lib/sessiontouch (там же — почему в памяти, а не в
 * sessionStorage).
 *
 * Плюс повтор по возвращении на вкладку: страница, открытая полгода назад и
 * ни разу не перезагруженная, иначе осталась бы с одним-единственным
 * продлением на старте.
 *
 * Из ответа берётся writer: может ли сессия писать (lib/writer). Запрос и так
 * уходит с каждой страницы, и спрашивать признак отдельно значило бы второй
 * круг до сервера ради того же ответа. По той же причине ответом сверяется и
 * подсказка о входе (settleSessionHint в lib/sessionhint): вход мимо главной
 * иначе оставлял бы на устройстве прежний вид входа — демо, вошедший через
 * Steam, продолжал бы видеть полосу «это чужая демо-библиотека».
 *
 * Стоит не в лэйауте, а в закулисье (components/Backstage): чанком, в простое
 * после гидратации. Продление уходит на долю секунды позже, и на столько же
 * позже приходят признак записи и сверка подсказки. Кнопкам, которые видны и
 * при «не знаем» (lib/writer), это безвредно: правду скажет первый же отказ.
 * А тем, что ждут признака спрятанными, — нет: «Запустить» и «Уже прошёл» на
 * странице игры (components/OwnedLaunch) и «Сыграю вечером на ПК»
 * (components/TonightButton) встают на столько же позже, и так же позже
 * /room/new сразу показывает сессии по ссылке «войди через Steam». Прогрев
 * квиза у вернувшегося из Steam ждёт этого ответа (prewarmWanted в
 * lib/warmup) и стартует на столько же позже — против секунд, за которые
 * отвечают на три вопроса, это мало. И отметка возврата (markReturn в
 * lib/retention) ставится этим же запросом: заход, закрытый раньше, чем
 * закулисье приехало, возвратом не посчитан. Полный счёт цены — в
 * components/BackstageLazy.
 */
export function SessionKeeper() {
  const pathname = usePathname()

  useEffect(() => {
    // На главной молчим: там свой вызов, и он же решает, что рисовать
    if (pathname === '/') return

    const touch = () => {
      if (!claimSessionTouch()) return
      // Продление — это Set-Cookie, а не тело. Из тела нужны writer и — для
      // сверки подсказки о входе — authed и steamid (settleSessionHint: без
      // строкового steamid она молча ничего не делает, так что урезать их из
      // ответа touch нельзя). Ошибку глотаем молча, но снимаем отметку, чтобы
      // следующая попытка состоялась. Признак и подсказку при сбое не
      // трогаем: пятисотка о сессии не говорит ничего, а прежний ответ
      // остаётся верным.
      fetch('/api/session/touch', { method: 'POST' })
        .then(async (r) => {
          if (!r.ok) return
          const body: unknown = await r.json()
          writerStore.set(writerFrom(body))
          settleSessionHint(body)
        })
        .catch(forgetSessionTouch)
    }

    touch()
    const onVisible = () => {
      if (document.visibilityState === 'visible') touch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [pathname])

  return null
}
