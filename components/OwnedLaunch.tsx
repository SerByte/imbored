'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { FinishedNote, MarkFinished } from '@/components/MarkFinished'
import { NeedSteam } from '@/components/NeedSteam'
import { SteamLaunch } from '@/components/SteamLaunch'
import { focusAdrift } from '@/lib/focushandoff'
import { lp, tr } from '@/lib/i18n'
import { forgetPlanned } from '@/lib/planforget'
import { isNeedSteam, writerStore } from '@/lib/writer'

/** Строка на месте ушедшей кнопки забирает фокус — только потерянный (lib/focushandoff) */
const takeLost = (el: HTMLElement | null) => {
  if (el && focusAdrift(document)) el.focus({ preventScroll: true })
}

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
 * его заход стоил бы вызова функции ни за что. Цена — время: SessionKeeper
 * едет закулисьем, в простое после гидратации (components/BackstageLazy),
 * и кнопки встают на этот простой и круг за чанком позже, чем вставали из
 * лэйаута; не доехало закулисье — их нет до перезагрузки.
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
 * Уже пройденной — не кнопка, а слово (done в том же ответе владения): как
 * в «Твоих вечерах». Отметка жила только в состоянии островка, и после
 * перезагрузки «Уже прошёл» возвращалась к игре с полки «Пройдено» — не
 * понять, сохранилось ли, а повторное нажатие писало ещё одну строку бана.
 * Слово — та же строка, что MarkFinished ставит после нажатия (FinishedNote),
 * с той же «Дальше — в духе X» при follow: одно состояние не должно выглядеть
 * по-разному до перезагрузки и после. Только без фокуса — его тут никто не
 * терял. done решает только ответ при монтировании: после нажатия
 * MarkFinished остаётся на месте — на его строке «Пройдено» стоит фокус.
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
 *
 * ОТКАЗ needsteam — СТРОКОЙ НА МЕСТЕ КНОПКИ. Права кончаются и при открытой
 * странице: во второй вкладке вставили ссылку на профиль, и кука стала
 * сессией только для чтения. Тогда «Уже прошёл» отвечает needsteam, и
 * writerStore.set(false) прятал её — вместе с фокусом, без единого слова:
 * «Отмечаю…», и кнопки нет, а зрячий мог решить, что игра отмечена. На /play
 * то же говорит NeedSteam у героя, в «Твоих вечерах» — NeedSteam под полкой,
 * а у страницы игры своей строки нет, и записка о просмотре (ReadOnlyNote)
 * в старой вкладке не приходит. Поэтому строку ставит тот, кто прячет кнопку:
 * why="save" — как под полкой «Твоих вечеров», у того же «Уже прошёл»; у
 * запуска с планом — why="launch", как на /play. Фокус она забирает только за
 * ушедшей «Уже прошёл»: «Запустить» на месте. Вход ведёт на квиз, а не сюда —
 * страницы игры нет в закрытом списке возвратов (lib/destination), как и у
 * ReadOnlyNote на ней; поэтому строка и не обещает «вернёшься сюда».
 *
 * Закрытый план забывает и выдача /play на устройстве (lib/planforget): сюда
 * чаще всего приходят из её ⓘ «Подробнее», и после «Назад» отложенный герой
 * иначе листался бы «Не то — дальше» молча — без ответа про игру, которую
 * только что запустили.
 *
 * Адрес страницы для входа — на её языке (lp): steamLoginFor берёт язык из
 * пути, и вход с /en/game/730 возвращает на английскую версию сайта, а не на
 * русскую.
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
  const locale = useLocale()
  const writer = useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server)
  const hasSession = writer !== null
  // appid рядом с ответом: при переходе на соседнюю карточку старое «да» не
  // должно мелькнуть у новой игры, пока едет её ответ
  const [owns, setOwns] = useState<{ appid: number; owned: boolean; plan: boolean; done: boolean } | null>(null)
  // Сервер ответил needsteam (докблок выше): на чём — и для какой игры, как owns
  const [denied, setDenied] = useState<{ appid: number; how: 'mark' | 'launch' } | null>(null)
  // Строка — только этой игре и только пока сессия правда не пишет: вошёл
  // через Steam в другой вкладке — кнопка вернётся, а строка уйдёт
  const shownDenial = denied?.appid === appid && writer !== true ? denied.how : null

  useEffect(() => {
    if (!hasSession) return
    let live = true
    fetch(`/api/session/owns?appid=${appid}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ owned?: unknown; plan?: unknown; done?: unknown }>) : null))
      .then((d) => {
        if (live && d) setOwns({ appid, owned: d.owned === true, plan: d.plan === true, done: d.done === true })
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
        label={tr(locale, { ru: 'Запустить', en: 'Launch' })}
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
                    if (await isNeedSteam(r)) {
                      setDenied((d) => (d?.appid === appid ? d : { appid, how: 'launch' }))
                      writerStore.set(false)
                    } else if (r.ok) forgetPlanned(appid)
                  })
                  .catch(() => {})
            : undefined
        }
      />
      {finishable &&
        writer === true &&
        (owns.done ? (
          <FinishedNote appid={appid} name={name} follow={follow} />
        ) : (
          <MarkFinished
            appid={appid}
            name={name}
            from="game"
            follow={follow}
            onDenied={() => {
              setDenied({ appid, how: 'mark' })
              writerStore.set(false)
            }}
            className={className}
          />
        ))}
      {/* basis-full — своей строкой посреди ряда кнопок страницы (flex-wrap,
          app/game/[appid]): сразу за «Страницей в Steam» и «Запустить», на
          месте ушедшей кнопки, а «Обзоры на YouTube» и «Позвать в эту игру»
          встают строкой ниже. Не order-last под весь ряд: глазом строка
          ушла бы вниз, а Tab и чтение — нет, и ссылка «войди через Steam»
          получала бы фокус раньше YouTube, стоя после неё */}
      {shownDenial && (
        <div
          ref={shownDenial === 'mark' ? takeLost : undefined}
          tabIndex={shownDenial === 'mark' ? -1 : undefined}
          className="basis-full outline-none"
        >
          <NeedSteam from={lp(locale, `/game/${appid}`)} why={shownDenial === 'launch' ? 'launch' : 'save'} />
        </div>
      )}
    </>
  )
}
