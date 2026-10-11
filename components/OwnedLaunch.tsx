'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { MarkFinished } from '@/components/MarkFinished'
import { SteamLaunch } from '@/components/SteamLaunch'
import { isNeedSteam, writerStore } from '@/lib/writer'

/**
 * «Запустить» — только тому, у кого игра есть.
 *
 * Страница игры общая для всех и живёт на ISR, поэтому решить это в разметке
 * нельзя: сервер не знает, кто смотрит. Раньше кнопка стояла у каждого —
 * включая гостя из поиска и вошедшего, у которого игры нет, — и steam://run
 * открывал ему клиент Steam с окном покупки вместо игры. На странице,
 * которая отвечает на «стоит ли играть», это кнопка, которая врёт.
 *
 * Спрашиваем только вошедшего. Признак «сессия есть» уже лежит в памяти
 * страницы: /api/session/touch зовёт каждая страница (SessionKeeper), и
 * writer в его ответе — boolean у любой сессии и null у гостя. Гость из
 * поиска — основной читатель пяти тысяч карточек, и лишний запрос на каждый
 * его заход стоил бы вызова функции ни за что.
 *
 * Ошибиться островок может только в одну сторону: не показать кнопку тому,
 * у кого игра есть (нет снапшота, сбой сети). Рядом всегда стоит «Страница в
 * Steam», так что это потеря удобства, а не тупик.
 *
 * На тач-устройствах не рисуется вовсе: steam://run там не работает, а ссылка
 * на магазин уже рядом (mobileLabel={null}, см. SteamLaunch).
 *
 * Рядом с запуском — «Уже прошёл» (components/MarkFinished): своя игра на
 * своей странице и есть то место, где её только что прошли, а закрыть её
 * было негде, кроме героя /play. Только владельцу, по тому же ответу, — и
 * только сессии, которой можно писать (writer === true; по вставленной
 * ссылке бан не записать). finishable решает сервер по тегам игры, той же
 * мерой, что у строки «Продолжить» на /play (isReplayable): у Dota 2 кнопки
 * нет. Разметка ISR от этого не меняется — всё дорисовывает островок.
 * Кнопка — и на телефоне: отметка не запуск, протокол ей не нужен.
 *
 * follow — звать ли после отметки «Дальше — в духе X». Решает страница, той
 * же полкой, что и ссылку «Похожее на X» внизу (data.similar): у игры без
 * соседей обе вели бы к экрану «похожих не нашлось», и две дороги на одной
 * странице спорили бы — нижняя честно спрятана, а эта звала бы туда же.
 *
 * План на вечер (lib/eveningplan.ts). Живая строка главной «Ставил «X» на
 * загрузку — ждёт тебя» ведёт сюда, и запуск отсюда обязан закрыть план —
 * иначе строка висела бы и после сыгранного вечера. Тот же ответ owns
 * говорит plan: true, и тогда нажатие пишет запуск так же, как строка плана
 * на /play (слот plan): план закрыт, исход совета заведён. Без плана запуск
 * отсюда по-прежнему ничего не пишет — это не совет, а своя игра.
 */
export function OwnedLaunch({
  appid,
  name,
  finishable,
  follow,
  className = '',
}: {
  appid: number
  name: string
  finishable: boolean
  follow: boolean
  className?: string
}) {
  const writer = useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server)
  const hasSession = writer !== null
  // appid рядом с ответом: при переходе на соседнюю карточку старое «да» не
  // должно мелькнуть у новой игры, пока едет её ответ
  const [owns, setOwns] = useState<{ appid: number; owned: boolean; plan: boolean } | null>(null)

  useEffect(() => {
    if (!hasSession) return
    let live = true
    fetch(`/api/session/owns?appid=${appid}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ owned?: unknown; plan?: unknown }>) : null))
      .then((d) => {
        if (live && d) setOwns({ appid, owned: d.owned === true, plan: d.plan === true })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [appid, hasSession])

  if (!owns || owns.appid !== appid || !owns.owned) return null
  return (
    <>
      <SteamLaunch
        appid={appid}
        label="Запустить"
        mobileLabel={null}
        icon
        className={className}
        onLaunch={
          owns.plan
            ? () =>
                // Отправил и забыл, как оценки на /play: потерянный запуск — это
                // строка плана, провисевшая до конца срока, а не сбой. needsteam —
                // права сменились, пока страница была открыта: страница узнаёт,
                // что сессия только читает (lib/writer)
                void fetch('/api/feedback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ appid, action: 'launched', ctx: { slot: 'plan', intent: 'launch' } }),
                })
                  .then(async (r) => {
                    if (await isNeedSteam(r)) writerStore.set(false)
                  })
                  .catch(() => {})
            : undefined
        }
      />
      {finishable && writer === true && (
        <MarkFinished
          appid={appid}
          name={name}
          from="game"
          follow={follow}
          onDenied={() => writerStore.set(false)}
          className={className}
        />
      )}
    </>
  )
}
