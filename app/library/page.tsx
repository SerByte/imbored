import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GameArt } from '@/components/GameArt'
import { SignOut } from '@/components/SignOut'
import { WarmCatalog } from '@/components/WarmCatalog'
import { BannedShelf, type BannedGame } from '@/components/BannedShelf'
import { feedbackStats, getGamesMeta, getLatestSnapshot, listBanned } from '@/lib/db'
import {
  buildLibraryView,
  dayKey,
  forgottenCandidates,
  LIBRARY_FILTERS,
  parseLibraryFilter,
  pickForgotten,
} from '@/lib/forgotten'
import { isUntouched, libraryTileState, type LibraryTileState } from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { backlogEquivalent, backlogValue } from '@/lib/stats'
import { bounceTo } from '@/lib/destination'
import { Eyebrow } from '@/components/Labels'
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
  const steamid = await currentSteamId()
  if (!steamid) redirect(bounceTo('/library'))

  const db = await getDb()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) redirect(bounceTo('/library'))

  const now = nowSec()
  const filter = parseLibraryFilter((await props.searchParams).state)
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
  const banned = await listBanned(db, steamid)
  const metas = await getGamesMeta(db, [
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
      art: meta?.art ?? null,
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
  const stats = await feedbackStats(db, steamid)
  // В библиотеку можно зайти в обход подбора: если обложек ещё нет — догреем
  const missingArt = games.filter((g) => !metas.get(g.appid)?.headerImage).length

  const metaOf = (id: number) => metas.get(id)
  const view = buildLibraryView(games, metaOf, filter, now)
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

      {(backlog.pricedCount > 0 || stats.rate !== null) && (
        <div className="grid md:grid-cols-2 gap-4 mb-10">
          {backlog.pricedCount > 0 && (
            <div className="glass rounded-[20px] p-5 flex items-center justify-between gap-4">
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
                className="shrink-0 rounded-[14px] bg-ember text-on-ember font-semibold px-4 py-2.5 text-sm hover:brightness-110 transition"
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
                className="library-tile glass glass-hover rounded-[14px] overflow-hidden"
              >
                <GameArt
                  appid={g.appid}
                  name={g.name}
                  headerImage={metas.get(g.appid)?.headerImage ?? null}
                  art={metas.get(g.appid)?.art ?? null}
                  sizes="(min-width: 768px) 20vw, 50vw"
                  className="w-full aspect-[460/215] object-cover"
                />
                <div className="p-3 text-sm font-semibold leading-tight truncate">{g.name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Чипсы — обычные ссылки: страница и так force-dynamic, а сетка на
          тысячу плиток обязана остаться серверной и без обработчиков.
          id — цель ссылки с полки «запечатанного»: приводить к фильтру,
          не показав самих чипсов, значит приводить в никуда. */}
      <div id="wall" className="flex flex-wrap gap-2 mb-6">
        {LIBRARY_FILTERS.map((f) => (
          <Link
            key={f.id}
            href={f.id === 'all' ? '/library' : `/library?state=${f.id}`}
            aria-current={f.id === filter ? 'page' : undefined}
            className={`rounded-full px-3.5 py-1.5 text-xs transition ${
              f.id === filter ? 'bg-ember text-on-ember font-semibold' : 'glass glass-hover text-dim'
            }`}
          >
            {f.label} <span className="font-mono">{view.counts[f.id]}</span>
          </Link>
        ))}
      </div>

      {view.games.length === 0 && (
        <p className="text-dim text-sm">Здесь пусто — и это хорошая новость.</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {view.games.map((g) => {
          const state = libraryTileState(g, now)
          const label = STATE_LABEL[state]
          const hours = Math.round(g.playtimeForever / 60)
          return (
            <Link
              key={g.appid}
              href={`/game/${g.appid}`}
              className={`library-tile glass glass-hover rounded-[14px] overflow-hidden ${
                state === 'comeback' ? 'opacity-75 hover:opacity-100' : ''
              }`}
            >
              <GameArt
                appid={g.appid}
                name={g.name}
                headerImage={metas.get(g.appid)?.headerImage ?? null}
                art={metas.get(g.appid)?.art ?? null}
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
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

      {/* Внизу намеренно: это уборка, а не витрина. Но на странице, а не в
          настройках, которых в проекте нет — бан ставится в одном клике от
          выдачи, и сниматься должен так же дёшево. */}
      <div className="mt-14">
        <BannedShelf games={bannedGames} />
      </div>

      {/* Выход живёт здесь, а не в шапке: шапка общая на весь сайт, и чтобы
          показать в ней состояние входа, корневому лэйауту пришлось бы читать
          куки — а это сделало бы динамическими все страницы разом, включая
          кэшируемые /game/[appid]. Библиотека и так force-dynamic. */}
      <SignOut />
    </div>
  )
}
