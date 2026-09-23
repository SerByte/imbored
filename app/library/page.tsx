import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GameArt } from '@/components/GameArt'
import { PrivacyHelp } from '@/components/PrivacyHelp'
import { SignOut } from '@/components/SignOut'
import { WarmCatalog } from '@/components/WarmCatalog'
import { BannedShelf, type BannedGame } from '@/components/BannedShelf'
import { trimArt } from '@/lib/art'
import { feedbackStats, getGamesMetaLite, getLatestSnapshot, listBanned } from '@/lib/db'
import {
  buildLibraryView,
  dayKey,
  forgottenCandidates,
  LIBRARY_FILTERS,
  LIBRARY_PAGE_SIZE,
  libraryHref,
  libraryPage,
  parseLibraryFilter,
  parseLibraryPage,
  pickForgotten,
  SHELF_EMPTY,
} from '@/lib/forgotten'
import { isUntouched, libraryTileState, type LibraryTileState } from '@/lib/recommend'
import { currentSession, getDb, isWriter, nowSec } from '@/lib/server'
import { backlogEquivalent, backlogValue } from '@/lib/stats'
import { bounceTo, reconnectHref } from '@/lib/destination'
import { Eyebrow } from '@/components/Labels'
import { LinkPending } from '@/components/LinkPending'
import { plural } from '@/lib/plural'

export const metadata = {
  title: 'Библиотека',
  description: 'Вся твоя Steam-библиотека одной стеной: что заброшено, что ни разу не запускалось и сколько это стоило.',
}

export const dynamic = 'force-dynamic'

/**
 * Две полосы бэклога читаются как иерархия: «не распакована» теперь стоит там,
 * где это правда (ноль минут), а игра, которую открыли и закрыли, получила своё
 * имя. Раньше обе были «не распакована» — включая ту, где на счётчике 110 минут.
 * Ember зарезервирован за «играешь сейчас» и в эту пару не отдаётся.
 */
const STATE_LABEL: Record<LibraryTileState, { text: string; cls: string }> = {
  active: { text: 'играешь сейчас', cls: 'text-ember-text' },
  untouched: { text: 'не распакована', cls: 'text-info' },
  unplayed: { text: 'открыл и закрыл', cls: 'text-info' },
  comeback: { text: 'заброшена', cls: 'text-dim' },
  played: { text: '', cls: 'text-dim' },
}

export default async function LibraryPage(props: PageProps<'/library'>) {
  // Сессия целиком, а не только steamid: SignOut ниже спрашивает, доказано ли
  // владение профилем — от этого зависит, предлагать ли «выйти везде».
  const session = await currentSession()
  const steamid = session?.steamid ?? null
  // Гостя без куки разворачивает proxy.ts настоящим 307 ещё до рендера:
  // отсюда редирект ушёл бы статусом 200 — каркас loading.tsx к этому моменту
  // уже отдан. Здесь остаются протухшая и поддельная кука.
  if (!steamid) redirect(bounceTo('/library'))

  const db = await getDb()
  /*
   * Три независимых чтения — одним заходом, а не лесенкой.
   *
   * Снапшот, забаненное и статистика отзывов друг от друга не зависят вовсе, а
   * шли по очереди: три обхода к Turso подряд там, где хватает одного. Страница
   * объявлена force-dynamic (export dynamic выше), кэша у неё нет, и эта
   * лесенка ложится в TTFB КАЖДОГО захода. По замеру из соседнего роута комнаты один
   * обход стоит около полутора сотен миллисекунд.
   *
   * Цена размена: у человека с сессией, но без снапшота (редирект строкой
   * ниже) два запроса уходят впустую. Это редкий случай — снапшот пишется тем
   * же действием, что заводит сессию, — и он молчаливый, в отличие от
   * задержки, которую видят все.
   *
   * getGamesMetaLite остаётся отдельно: ему нужны appid И из библиотеки, И из
   * забаненного, то есть он честно зависит от обоих.
   */
  const [snapshot, banned, stats] = await Promise.all([
    getLatestSnapshot(db, steamid),
    listBanned(db, steamid),
    feedbackStats(db, steamid),
  ])
  if (!snapshot) redirect(bounceTo('/library'))

  const now = nowSec()
  const query = await props.searchParams
  const filter = parseLibraryFilter(query.state)
  // Сводка, деньги и прогрев считаются по ВСЕЙ библиотеке, а не по выбранной
  // полке: иначе числа в шапке прыгали бы вслед за фильтром
  const games = snapshot.games
  const totalHours = Math.round(games.reduce((s, g) => s + g.playtimeForever, 0) / 60)
  // Два разных числа: в строке-сводке — «ни разу не запускал» (ноль минут), в
  // карточке денег — весь бэклог до двух часов, как и раньше. Деньги считает
  // backlogValue по своему определению, и оно намеренно не менялось.
  const untouched = games.filter(isUntouched).length

  // Только игры библиотеки, а не весь каталог: нужны обложки для сетки и
  // цена бэклога, и то и другое считается по своим играм.
  //
  // Забаненное добирается тем же запросом, а не вторым: забанить можно и игру,
  // которой у тебя нет (герой /play бывает каталожным), поэтому её appid в
  // библиотеке не встретится, но обложка на полку нужна.
  // Узкой выборкой: скриншоты на этой странице не показываются нигде
  const metas = await getGamesMetaLite(db, [
    ...new Set([...games.map((g) => g.appid), ...banned.map((b) => b.appid)]),
  ])
  const bannedGames: BannedGame[] = banned.map((b) => {
    const meta = metas.get(b.appid)
    return {
      appid: b.appid,
      // Каталог мог не дойти до этой игры — имя как у ArtPlaceholder, но полка
      // всё равно обязана показать плитку: иначе бан не снять вообще
      name: meta?.name ?? `Игра ${b.appid}`,
      headerImage: meta?.headerImage ?? null,
      art: trimArt(meta?.art),
      done: b.done,
    }
  })
  const backlog = backlogValue(games, (id) => metas.get(id), now)
  // Строка разрезается по {n}, чтобы число осталось моноширинным, как все
  // числа в проекте, а не растворилось в тексте
  const equivalent = (() => {
    const eq = backlogEquivalent(backlog.cents, steamid)
    if (!eq) return null
    const [before, after] = eq.text.split('{n}')
    return { count: eq.count, before, after }
  })()

  // В библиотеку можно зайти в обход подбора: если обложек ещё нет — догреем
  const missingArt = games.filter((g) => !metas.get(g.appid)?.headerImage).length

  const metaOf = (id: number) => metas.get(id)
  const view = buildLibraryView(games, metaOf, filter, now)
  // Порция полки, а не вся полка: см. LIBRARY_PAGE_SIZE в lib/forgotten.ts
  const wall = libraryPage(view.games, parseLibraryPage(query.page))
  const shelf = pickForgotten(
    forgottenCandidates(games, metaOf),
    // Соль обязательна: без неё первый слот полки коррелировал бы с выбором
    // «Игры дня» — там сид тех же двух частей
    `${steamid}:${dayKey(new Date(now * 1000))}:shelf`,
  )

  return (
    <div className="flex-1 mx-auto w-full max-w-6xl px-5 pt-28 pb-16">
      <WarmCatalog enabled={missingArt > 0} />
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <h1 className="font-display text-display-md">
          Твоя библиотека глазами сервиса
        </h1>
        <Link
          href="/portrait"
          prefetch={false}
          className="rounded-[14px] glass glass-hover px-4 py-2 text-sm shrink-0"
        >
          Мой портрет игрока →
        </Link>
      </div>
      <p className="text-dim text-sm mb-6">
        <span className="font-mono">{games.length}</span>{' '}
        {plural(games.length, 'игра', 'игры', 'игр')} ·{' '}
        <span className="font-mono">{totalHours.toLocaleString('ru-RU')}</span>{' '}
        {plural(totalHours, 'час', 'часа', 'часов')} ·{' '}
        <span className="font-mono">{untouched}</span> ни разу не запускал
      </p>

      {/*
        ПУСТАЯ БИБЛИОТЕКА — НЕ ПУСТАЯ ПОЛКА.
        
        До этой правки страница показывала здесь пять чипсов с нулями и строку
        «Здесь пусто — и это хорошая новость». Замерено снимком: весь экран
        человека, у которого ничего не загрузилось, состоял из заголовка, трёх
        нулей, пяти нулевых чипсов, этой строки — и двух ссылок «Выйти».
        Единственным заметным действием на странице был выход.
        
        Причина почти всегда одна и та же, и она чинится за минуту: Steam по
        умолчанию прячет список игр даже при публичном профиле. Сюда доезжают
        только те, у кого сессия и снимок ЕСТЬ, — то есть отказ случился уже
        после подключения, и на карточке подключения этот текст человек не
        увидит никогда.
        
        Чипсы и сетка ниже при пустой библиотеке не рисуются вовсе: пять нулей
        не сообщают ничего, а якорь #wall на них ведёт только с полки
        «запечатанного», которой здесь тоже нет.
      */}
      {games.length === 0 && (
        <section className="max-w-2xl">
          <p className="font-semibold text-ink mb-2">Steam не отдал ни одной игры</p>
          <p className="text-dim text-sm leading-relaxed mb-5">
            Причин ровно две: игровые данные закрыты настройками профиля — или библиотека правда
            пуста. Первая встречается намного чаще.
          </p>
          <PrivacyHelp />
          <Link href={reconnectHref()} className="btn-ember mt-5 px-6 py-3">
            Подключить заново
          </Link>
        </section>
      )}

      {(backlog.pricedCount > 0 || stats.rate !== null) && (
        <div className="grid md:grid-cols-2 gap-4 mb-10">
          {backlog.pricedCount > 0 && (
            /*
              Ниже 1024px карточка встаёт столбиком, и это не вкусовщина.

              Строкой она собрана под ДЕСКТОП, где рядом стоит вторая карточка
              и на текст остаётся 369px при кнопке 121px — всё ложится в одну-
              две строки. На 375px карточка становится во всю ширину, но кнопка
              shrink-0 держит свои 130px, и тексту достаётся 156px из 335: и
              заголовок, и подпись переносятся вдвое, а фраза про Game Pass
              растягивается на четыре строки рядом с пустым местом под кнопкой.

              Порог lg, и это ИСПРАВЛЕНИЕ прежней правки, где стоял sm. Тогда я
              рассуждал «выше 640 карточка во всю ширину» — верно ровно до 768,
              где включается md:grid-cols-2 и карточка снова становится узкой.
              Замер на 768: карточка 349px, текст 170px, строки 2/2/3 — почти то
              же самое, что чинили на телефоне. На 1024 карточка 484px, тексту
              достаётся 307px, и этого хватает на 1/1/2.

              Между 640 и 1024 карточка стоит столбиком, хотя строкой там местами
              влезла бы: это плата за один порог вместо контейнерного запроса.
              Контейнерные запросы в Tailwind 4.3 есть, но требуют лишней
              обёртки — элемент не может опрашивать сам себя, — и заводить новый
              паттерн ради одной карточки не стоит.
            */
            <div className="glass rounded-[20px] p-5 flex flex-col items-start gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-lg font-bold">
                  ≥ <span className="font-mono text-ember-text">${(backlog.cents / 100).toFixed(0)}</span>{' '}
                  лежит несыгранным
                </div>
                <div className="text-xs text-dim mt-1">
                  {backlog.unplayedCount} {plural(backlog.unplayedCount, 'игра', 'игры', 'игр')} в бэклоге, у {backlog.pricedCount} известна цена
                </div>
                {equivalent && (
                  <div className="text-xs text-dim mt-2">
                    {equivalent.before}
                    <span className="font-mono text-ember-text">{equivalent.count}</span>
                    {equivalent.after}
                  </div>
                )}
              </div>
              {/* Не в общий опрос про настроение: карточка про несыгранное —
                  значит и подбор про несыгранное */}
              <Link
                href="/quiz?from=untouched"
                className="btn-ember shrink-0 px-4 py-2.5 text-sm"
              >
                Разгрести →
              </Link>
            </div>
          )}
          {stats.rate !== null && (
            <div className="glass rounded-[20px] p-5">
              <div className="text-lg font-bold">
                Подбор попадает в{' '}
                <span className="font-mono text-ember-text">{Math.round(stats.rate * 100)}%</span>
              </div>
              <div className="text-xs text-dim mt-1">
                {stats.liked} «зашло» против {stats.skipped} «не то»
              </div>
            </div>
          )}
        </div>
      )}

      {shelf.length > 0 && (
        <section className="mb-12">
          <Eyebrow className="mb-2">Запечатанное</Eyebrow>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            {/* Заголовок намеренно без числа: «пять игр» — ложь при трёх, а
                согласование «{N} игр, о которых ты забыл» — фабрика багов.
                Число уже стоит в строке-сводке выше. */}
            <h2 className="font-display text-display-sm">
              Ты забыл, что они у тебя есть
            </h2>
            {/*
              Ссылка ведёт к ФИЛЬТРУ, а не к подбору, и это не мелочь.
              Раньше здесь стояло второе «Разгрести →» на тот же адрес, что и
              кнопка в карточке денег двумя блоками выше: одно действие в двух
              весах — залитой кнопкой и тихой строкой, — то есть оформление
              обещало разницу, которой нет.
              Полка — дневная выборка из пяти, о чём прямо сказано ниже
              («завтра на полке будут другие»). Естественный вопрос к такой
              строке — «а какие ещё?», и до сих пор ответом было прокрутить
              страницу и найти нужный чипс. Показываем только когда за полкой
              действительно кто-то есть.
            */}
            {untouched > shelf.length && (
              <Link
                href="/library?state=untouched#wall"
                prefetch={false}
                className="tap text-sm text-ember-text hover:underline shrink-0"
              >
                Все нераспакованные →
              </Link>
            )}
          </div>
          {/* «По данным Steam», а не «ты никогда в это не играл»: ноль часов
              бывает и у офлайн-игры, и у аккаунта старше 2009 года */}
          {/* max-w-md — мера набора. Подпись стоит в контейнере шириной 1152 px, и
                без ограничения строка растягивалась на 110–180 символов: вдвое
                дальше комфортных 45–75. Сейчас она в одну строку и это сходит с
                рук, но любая правка текста начала бы переносить её на такой
                ширине. Величина та же, что у остальной поясняющей копии
                продукта. */}
          <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
            Ни одну из них ты не запускал — по данным Steam там ноль минут. Завтра на полке будут
            другие.
          </p>
          {/*
            ЛЕСТНИЦА, А НЕ СТУПЕНЬКА. Было `grid-cols-2 md:grid-cols-5`, то
            есть пять колонок начинались с 768 px — с ширины, для которой пять
            и не рассчитывались. Замерено в браузере: на телефоне (375)
            обложка полки 160 px, на планшете (768) — 130. Расширяешь окно, и
            обложки СЖИМАЮТСЯ на пятую часть, а подписи начинают обрезаться.
            Промежуточная ступень в три колонки закрывает полосу 640–1023
            (232 px на 768), пять остаются там, где для них есть место.
          */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {shelf.map((g) => (
              <Link
                key={g.appid}
                href={`/game/${g.appid}`}
                prefetch={false}
                className="library-tile glass glass-hover rounded-[14px] overflow-hidden"
              >
                <GameArt
                  appid={g.appid}
                  name={g.name}
                  headerImage={metas.get(g.appid)?.headerImage ?? null}
                  art={trimArt(metas.get(g.appid)?.art)}
                  /* Пороги — те же, что у лестницы колонок выше: 2 → 3 → 5.
                     Прежняя «(min-width: 768px) 20vw, 50vw» осталась от
                     сетки 2 → 5 и в полосе 640–1023 промахивалась: просила
                     то 50vw, то 20vw при настоящих 33vw. */
                  sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                  className="w-full aspect-[460/215] object-cover"
                />
                <div className="p-3 text-sm font-semibold leading-tight truncate">{g.name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Чипсы — обычные ссылки: страница и так force-dynamic, а сетка
          обязана остаться серверной и без обработчиков. Префетча у них нет:
          каждый чипс — эта же динамическая страница, то есть пять вызовов
          функции на один просмотр ради фильтров, которые откроют один раз.
          id — цель ссылки с полки «запечатанного»: приводить к фильтру,
          не показав самих чипсов, значит приводить в никуда. */}
      {games.length > 0 && (
      <div id="wall" className="flex flex-wrap gap-2 mb-6">
        {LIBRARY_FILTERS.map((f) => (
          <Link
            key={f.id}
            href={libraryHref(f.id)}
            prefetch={false}
            aria-current={f.id === filter ? 'page' : undefined}
            className={`rounded-full px-3.5 py-1.5 text-xs transition ${
              f.id === filter ? 'bg-ember text-on-ember font-semibold' : 'glass glass-hover text-dim'
            }`}
          >
            {f.label} <span className="font-mono">{view.counts[f.id]}</span>
          </Link>
        ))}
      </div>
      )}

      {/* games.length в условии обязателен: у пустой библиотеки пуста и любая
          полка, и без него человек с ?state=active получил бы два сообщения
          сразу — «за две недели ты не запускал ничего» поверх «Steam не отдал
          ни одной игры». */}
      {games.length > 0 && view.games.length === 0 && filter !== 'all' && (
        <p className="text-dim text-sm">{SHELF_EMPTY[filter]}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {wall.shown.map((g) => {
          const state = libraryTileState(g, now)
          const label = STATE_LABEL[state]
          const hours = Math.round(g.playtimeForever / 60)
          return (
            /*
              Без префетча: плитка попадает в экран при прокрутке, и каждая
              префетчила бы /game/<appid>. Игры вне заранее собранных страниц
              рендерятся по требованию, то есть порция из 48 плиток — это до
              48 рендеров с походами в базу ради страниц, куда человек
              откроет одну.
            */
            <Link
              key={g.appid}
              href={`/game/${g.appid}`}
              prefetch={false}
              className={`library-tile glass glass-hover rounded-[14px] overflow-hidden ${
                state === 'comeback' ? 'opacity-75 hover:opacity-100' : ''
              }`}
            >
              <GameArt
                appid={g.appid}
                name={g.name}
                headerImage={metas.get(g.appid)?.headerImage ?? null}
                art={trimArt(metas.get(g.appid)?.art)}
                /* Пороги подсказки обязаны совпадать с сеткой, а она тут
                   grid-cols-2 md:grid-cols-4 — то есть ровно 50vw и 25vw.
                   Стояли пороги 1024 и 640: в полосе 640–767 подсказка просила
                   33vw при настоящих 50vw, и плитки грузились ПОЛТОРА раза
                   мельче нужного, то есть мылом. */
                sizes="(min-width: 768px) 25vw, 50vw"
                className="w-full aspect-[460/215] object-cover"
              />
              <div className="p-3">
                <div className="text-sm font-semibold leading-tight truncate">{g.name}</div>
                <div className="text-[11px] mt-1 flex items-center justify-between">
                  <span className="font-mono text-dim">
                    {hours > 0 ? `${hours} ч` : g.playtimeForever > 0 ? `${g.playtimeForever} мин` : '0 ч'}
                  </span>
                  {label.text && <span className={label.cls}>{label.text}</span>}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/*
        «ПОКАЗАТЬ ЕЩЁ» — ССЫЛКА, А НЕ КНОПКА С КЛИЕНТСКОЙ ПОДГРУЗКОЙ.
        Следующая порция — тот же серверный рендер с ?page=N: сетка остаётся
        без клиентского состояния, работает без JS, и адрес можно отправить.
        scroll={false} — человек остаётся там, где нажал, и новые плитки встают
        прямо под прочитанными; без него Next прокрутил бы к верху страницы,
        раз её начало уже уехало из экрана. Префетча нет по той же причине,
        что у чипсов: это та же динамическая страница.
      */}
      {wall.nextPage !== null && (
        <div className="mt-8 flex justify-center">
          <Link
            href={libraryHref(filter, wall.nextPage)}
            scroll={false}
            prefetch={false}
            className="rounded-[14px] glass glass-hover px-5 py-2.5 text-sm"
          >
            <LinkPending>
              Показать ещё <span className="font-mono">{Math.min(wall.rest, LIBRARY_PAGE_SIZE)}</span>{' '}
              из <span className="font-mono">{wall.rest}</span>
            </LinkPending>
          </Link>
        </div>
      )}

      {/* Внизу намеренно: это уборка, а не витрина. Но на странице, а не в
          настройках, которых в проекте нет — бан ставится в одном клике от
          выдачи, и сниматься должен так же дёшево. */}
      <div className="mt-14">
        {/* Сессия есть наверняка: без неё страница развернула бы на вход */}
        <BannedShelf games={bannedGames} writer={session ? isWriter(session) : false} />
      </div>

      {/* Выход живёт здесь, а не в шапке: шапка общая на весь сайт, и чтобы
          показать в ней состояние входа, корневому лэйауту пришлось бы читать
          куки — а это сделало бы динамическими все страницы разом, включая
          кэшируемые /game/[appid]. Библиотека и так force-dynamic. */}
      <SignOut verified={Boolean(session?.verified)} />
    </div>
  )
}
