'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Ambient } from '@/components/Ambient'
import { GameArt } from '@/components/GameArt'
import { NeedSteam } from '@/components/NeedSteam'
import { useShareLink } from '@/components/ShareLink'
import { CeremonyBoundary } from '@/components/room/CeremonyBoundary'
import { RoomWaiting } from '@/components/room/RoomWaiting'
import { Spinner } from '@/components/Spinner'
import { StatusLine } from '@/components/StatusLine'
import { Icon } from '@/components/Icon'
import { Notice } from '@/components/Notice'
import { SwipeDeck } from '@/components/SwipeDeck'
import type { LikedGame } from '@/components/room/LikesStrips'
import type { GameArtUrls } from '@/lib/art'
import {
  cappedSignal,
  claimVote,
  deckStuck,
  type MembershipView,
  membershipLapsed,
  pollCaughtUp,
  voteMiss,
  voteSignal,
} from '@/lib/deckvote'
import type { Discount } from '@/lib/discount'
import type { GameTrait } from '@/lib/gametraits'
import type { Mood } from '@/lib/types'
import {
  awaitingOthers,
  kickHandoffDue,
  type KickTicket,
  matchLine,
  publicFailure,
  ROOM_MAX_MEMBERS,
  type RoomMiss,
  roomMissText,
  roomTabTitle,
  type RoomMemberView,
  waitsInBackground,
} from '@/lib/room'
import { plural } from '@/lib/plural'
import { roomPresetOf } from '@/lib/presets'
import type { InviteDoor } from '@/lib/roominvite'
import type { LeaderOffer, NearMiss } from '@/lib/roomlikes'
import { HIDDEN_POLL_CAP_MS, hiddenPollDelay, nextPollStep, snapshotFate } from '@/lib/roompoll'
import { announceMatch } from '@/components/room/MatchNotify'
import { isNeedSteam, writerStore } from '@/lib/writer'
import { focusAdrift } from '@/lib/focushandoff'
import { roomShareUrl } from '@/lib/roomshare'
import { forgetGuest } from '@/lib/sessionhint'
import { storeLink } from '@/lib/storelink'
import { track } from '@/lib/track'

/*
 * Церемония матча догружается отдельно.
 *
 * MatchCeremony тянет за собой ядро gsap и SplitHeading с плагином SplitText,
 * а на этой странице ничего из этого больше не нужно никому. Ядро gsap не
 * везёт и корневой лэйаут: плавная прокрутка догружает его отдельно и не всем
 * (components/SmoothScroll.tsx).
 * Статический импорт клал этот вес в начальный набор скриптов комнаты — то
 * есть его качал и разбирал КАЖДЫЙ участник пати до первого свайпа, при том
 * что экран матча терминальный: случается один раз на комнату и только если
 * она вообще сошлась.
 *
 * ssr: false ничего не стоит: страница целиком клиентская (опрос каждые 2.5 с),
 * а церемония рисуется только при status === 'matched', то есть заведомо
 * после первого ответа сервера. Заголовок здесь не серверный и не LCP, так
 * что, отдав его клиенту, мы ничем не рискуем.
 *
 * Чего ssr: false не учитывал: кусок впервые запрашивается В МИНУТУ МАТЧА,
 * через час-другой после загрузки страницы. Не дошёл он (моргнула сеть; деплой
 * сменил хеш, и старый кусок отвечает 404) — React.lazy внутри
 * next/dynamic отклонялся без своей границы, ошибка уходила в app/error.tsx, и
 * вместо «Это матч!» вся комната видела «Что-то сломалось». «Попробовать
 * снова» не помогало: lazy помнит отказ, повтор бросает его же.
 *
 * Поэтому две вещи. Кусок прогревается, пока комната открыта (эффект warm
 * ниже): он приезжает из того же деплоя, что и страница, а к матчу лежит
 * готовым. В начальный набор скриптов он по-прежнему не входит — качается в
 * простое, а не до первого кадра. Цена прогрева — те же байты у участника
 * комнаты, которая так и не сойдётся; это дешевле, чем экран поломки на
 * главной эмоции продукта. И у церемонии своя граница (CeremonyBoundary):
 * если кусок всё же не пришёл, на экране остаётся матч — игра, ссылка в
 * магазин и «Обновить страницу», — а не экран поломки.
 */
const loadCeremony = () => import('@/components/MatchCeremony')
const LazyCeremony = dynamic(() => loadCeremony().then((m) => m.MatchCeremony), { ssr: false })
function MatchCeremony(props: ComponentProps<typeof LazyCeremony>) {
  return (
    <CeremonyBoundary
      game={props.game}
      memberCount={props.memberCount}
      takeFocus={props.takeFocus ?? false}
    >
      <LazyCeremony {...props} />
    </CeremonyBoundary>
  )
}

type RoomState = {
  room: {
    id: string
    status: 'open' | 'matched'
    matchedAppid: number | null
    isPublic: boolean
    deckRound: number
    deckSize: number | null
    /** настроение, под которое собрана колода; null — у старой комнаты его нет */
    mood?: Mood | null
  }
  isHost: boolean
  members: RoomMemberView[]
  hasSession: boolean
  isMember: boolean
  /**
   * Сессия по ссылке на профиль, который сидит в комнате со входом через
   * Steam: действовать за него она не может (lib/roomseat), «Войти в комнату»
   * ей откажет — поможет только вход через Steam. Необязательное: старый
   * сервер поля не присылал.
   */
  needSteam?: boolean
  /**
   * Экран приглашения — готовыми строками, теми же словами, что карточка в
   * чате (inviteDoor в lib/roominvite). Только не-участнику открытой комнаты;
   * null и отсутствие — экран прежний.
   */
  invite?: InviteDoor | null
  matchedGame: {
    appid: number
    name: string
    headerImage: string | null
    art: GameArtUrls | null
    store: string | null
    storeUrl: string | null
    /** есть ли игра у смотрящего; null — не знаем */
    ownedByMe: boolean | null
    /** сколько участников за; null — смотрит не участник */
    forCount: number | null
    /** у кого из остальных её нет; null — не участник, нет поля — старый сервер */
    missingFor?: string[] | null
    isFree: boolean
    priceFinal: number | null
    /** регион магазина цены — её валюта (lib/steamregion) */
    priceCc: string | null
    /** магазин региона игру не показывает */
    unsold: boolean
    discount: Discount | null
  } | null
}

/*
 * Ключ колоды — функция состава комнаты и раунда (см. докблок у deckWant).
 * Одна формула на эффект колоды и на «Ещё 20 игр»: pullMore пишет ключ того,
 * что грузит сам, и разъехавшиеся формулы снова дали бы двойной GET /deck.
 */
function deckKeyOf(s: RoomState | null): string {
  return s?.isMember ? `${s.members.length}:${s.room.deckRound}` : ''
}

/** Своё членство в снимке — для membershipLapsed (lib/deckvote) */
function membershipOf(s: RoomState): MembershipView {
  return { isMember: s.isMember, myVotes: s.members.find((m) => m.me)?.votes ?? null }
}

/** Ответ /likes: свои «играем», почти-совпадения и лидер голосов */
type Likes = { mine: LikedGame[]; near: NearMiss[]; leader: LeaderOffer | null }

type Card = {
  appid: number
  name: string
  ownedByAll: boolean
  missingFor: string[]
  priceFinal?: number
  priceCc?: string | null
  unsold?: boolean
  isFree?: boolean
  discount?: Discount | null
  headerImage: string | null
  art?: GameArtUrls | null
  ccu?: number | null
  /** «Матч ~15 мин» — длина захода из семантики, см. DeckCard */
  session?: GameTrait | null
  tags: string[]
  store?: string
  storeUrl?: string
  /** Подпись первой карты «Позвать в эту игру» (PINNED_REASON в lib/group) — рисует SwipeDeck */
  reason?: string
}

/** Обычный темп опроса и замедленный — когда в комнате давно ничего не двигается */
const POLL_FAST_MS = 2500
const POLL_SLOW_MS = 6000
const POLL_IDLE_AFTER_MS = 60_000
/**
 * Потолок ожидания одного опроса.
 *
 * Пока запрос в полёте, тик только перевзводит таймер и отказа не считает, а
 * своего срока у fetch нет. Телефон сменил Wi-Fi на LTE, соединение HTTP/2
 * повисло на минуты — и ростер, голоса и старт матча замерзали без плашки
 * «связь потеряна»: человек думал, что друзья ещё свайпают. По потолку запрос
 * отменяется, попадает в catch и считается отказом, как обрыв.
 *
 * Своим таймером на тот же AbortController, а не AbortSignal.any: того нет в
 * Safari до 17.4, и на нём опрос падал бы в catch на каждом тике.
 *
 * Тот же потолок — у выхода, ✕ хоста, «Пустить обратно» и переключателя
 * доски (cappedSignal в lib/deckvote): их флаги «в пути» гасят повтор, и
 * повисший запрос держал бы кнопку мёртвой без строки отказа.
 */
const POLL_TIMEOUT_MS = 8_000
/** Пол по частоте для догрузки лайков — см. докблок у эффекта */
const LIKES_MIN_GAP_MS = 12_000

/**
 * Видна ли вкладка — как внешнее хранилище, чтобы эффекты колоды и лайков
 * догнали отложенное при возвращении. Функции на модуле: useSyncExternalStore требует
 * стабильные. На сервере вкладка «видна» — там эффектов нет вовсе.
 */
function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}
const readVisible = () => document.visibilityState === 'visible'
const serverVisible = () => true

export default function RoomPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const roomId = (params.id ?? '').toUpperCase()

  /**
   * Позвать своих — главное действие комнаты на одного.
   *
   * Логика общая с полем на /compat: на телефоне системная панель
   * «Поделиться», на десктопе буфер, а при отказе буфера — запасной путь
   * через execCommand. Здесь было своё копирование с одним только
   * асинхронным API: в мессенджерном webview он отказывает, и ссылку на пати
   * приходилось выделять руками там, где второй путь сработал бы.
   *
   * Поле со ссылкой в AloneInvite остаётся последним рубежом — теперь оно
   * показывается только когда отказали ОБА пути, а не первый.
   */
  // Адрес комнаты без хвоста своей страницы: window.location.href уносил бы
  // и чужие метки из адреса того, кто делится
  const share = useShareLink(
    'room',
    () => roomShareUrl(window.location.origin, roomId),
    `Пати ${roomId} — imbored`,
    'Выберем игру на вечер вместе',
  )
  const copyLink = () => void share.run()

  const [state, setState] = useState<RoomState | null>(null)
  const [notFound, setNotFound] = useState(false)
  /** Комната на экране устарела: опрос идёт, но ответов нет. */
  const [stale, setStale] = useState(false)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [nowSec, setNowSec] = useState(0)
  const [deckTotal, setDeckTotal] = useState(0)
  const [deckVoted, setDeckVoted] = useState(0)
  const [deckFailed, setDeckFailed] = useState(false)
  // Отказ по потолку частоты (429) — не поломка: «на нашей стороне» и
  // «попробуй ещё раз» сразу же упёрлись бы в тот же потолок
  const [deckLimited, setDeckLimited] = useState(false)
  /*
   * Запрос колоды уже в полёте.
   *
   * Один клик «Ещё 20 игр» слал ДВА GET /deck: pullMore зовёт loadDeck явно
   * («свою колоду забираем сразу»), а эффект ниже видит поднятый раунд после
   * refresh и зовёт его же. Оба нужны по отдельности — эффект ловит чужой
   * вход, явный вызов даёт немедленность нажавшему, — поэтому убирать надо не
   * один из них, а дубль: второй заход становится пустышкой.
   *
   * Пустышкой становился и заход за ДРУГИМ ключом. Эффект писал новый ключ и
   * звал loadDeck, а тот выходил по флагу: ответ в полёте собран по составу,
   * который сервер прочитал в начале запроса (маршрут идёт 1.6–2.8 с), и
   * второй друг, вошедший в эти секунды, в колоду не попадал — ни его
   * лучшие карты, ни «Есть у всех» с поправкой на него. Ровно то, что ключ
   * колоды и чинил («поздний гость оставлял всех со стухшей колодой»).
   * Теперь эффект, пока запрос в полёте, ключ не трогает, а конец запроса
   * (deckLoads) перезапускает его: отставший ключ догружается одним запросом.
   */
  const deckInFlight = useRef(false)
  /** Сколько запросов колоды закончилось — будит эффект колоды, см. выше */
  const [deckLoads, setDeckLoads] = useState(0)
  /*
   * Что отсвайпано на этом устройстве и ещё может не доехать до сервера.
   *
   * Слияние в loadDeck добавляет всё, чего нет на руках. Карта, только что
   * убранная свайпом, на руках уже отсутствует — и если ответ /deck собран
   * ДО того, как доехал голос, она возвращается в колоду и человек свайпает
   * её второй раз. Отказавший голос вычёркивает appid обратно: там карта
   * возвращается намеренно, и прятать её нельзя.
   *
   * Он же — пропуск для голоса: второй жест по карте, которая уже здесь,
   * не уходит (claimVote в lib/deckvote).
   */
  const votedLocally = useRef<Set<number>>(new Set())
  /** Последний голос не доехал: карта возвращена, счётчик отмотан назад. */
  const [voteFailed, setVoteFailed] = useState(false)
  const [localVotes, setLocalVotes] = useState(0)
  const [busy, setBusy] = useState(false)
  /**
   * Отказ входа. Появился вместе с потолком на /api/connect ради демо-друга,
   * теперь им же говорит и обычный вход: комнаты нет, сессия истекла, сеть.
   */
  const [joinError, setJoinError] = useState<string | null>(null)
  const [likes, setLikes] = useState<Likes>({ mine: [], near: [], leader: null })
  const [takingLeader, setTakingLeader] = useState(false)
  /** «Берём» не дошло: 'stale' — голоса сдвинулись, 'failed' — сеть или сервер */
  const [leaderMiss, setLeaderMiss] = useState<'stale' | 'failed' | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [pulling, setPulling] = useState(false)
  /** Добор раунда не удался — кнопка обязана вернуться нажимаемой */
  const [pullFailed, setPullFailed] = useState(false)
  /**
   * Хост вошёл по вставленной ссылке: вывесить комнату на доску и убрать
   * другого ему нельзя (403 needsteam, см. requireWriter в lib/server и
   * leave/route.ts). Создать такую комнату он не может, но хостом по ссылке
   * становятся — рука переходит к участнику по ссылке, когда хост уходит, а
   * вошедших через Steam в комнате нет (removeRoomMember), — и переключатель
   * с крестиком молча не срабатывали бы. Отсюда строка о входе через Steam.
   */
  const [publicDenied, setPublicDenied] = useState(false)
  /*
   * Выход, ✕ хоста и переключатель доски: запрос в пути и его отказ. Все три
   * молчали — `.catch(() => null)` и `if (!res?.ok) return`, — и не гасили
   * повтор: двойной тап по ✕ слал два POST. Правило продукта то же, что у
   * «Берём» и «Ещё 20 игр»: отказ виден и слышен, повтор гасит обработчик.
   *
   * Отказ хранится вместе с тем, при чём он случился (RoomMiss), а на экран
   * выводится roomMissText: строка гаснет, когда перестала быть правдой, а не
   * только со следующей попыткой.
   */
  const [leaving, setLeaving] = useState(false)
  const [leaveMiss, setLeaveMiss] = useState<RoomMiss | null>(null)
  const [publicBusy, setPublicBusy] = useState(false)
  const [publicMiss, setPublicMiss] = useState<RoomMiss | null>(null)
  /**
   * Кого хост только что убрал ✕ — для «Пустить обратно».
   *
   * Убранный не входит обратно полчаса (ROOM_KICK_SEC в lib/room), а ✕ —
   * маленький крестик рядом с ником, и промах по соседней строке стоил другу
   * тех же получаса. Строка живёт, пока хост на странице и пока убранный не
   * вернулся в ростер: дальше отменять нечего. id — тот же memberKey, каким
   * его убирали, — сервер сверит его с отметками комнаты (leave/route.ts).
   */
  const [kicked, setKicked] = useState<{
    id: string
    name: string
    phase: 'shown' | 'busy' | 'failed' | 'done'
  } | null>(null)
  /**
   * Комната была открыта на глазах у этого экрана. Матч, пришедший после, —
   * новость: о нём говорит строка matchStatus, а церемония забирает фокус.
   * Открыл ссылку на уже сошедшуюся комнату — новости нет (matchLine в lib/room).
   */
  const [sawOpen, setSawOpen] = useState(false)
  /** Матч пришёл в скрытую вкладку, и её с тех пор не открывали — «●» в заголовке */
  const [unseen, setUnseen] = useState(false)
  /**
   * Зеркало «есть что узнать из фона» (waitsInBackground в lib/room) для
   * опроса. Эффект опроса держит в замыкании lastChangeAt и счёт отказов;
   * зависимость от этого флага пересоздавала бы его на каждом конце колоды и
   * сбрасывала бы и то и другое. Ref он читает на каждом тике.
   */
  const waitingRef = useRef(false)
  /**
   * Матч вызвал сам человек: его последний голос или его «Берём». Снаружи
   * такой матч приходит тем же refresh, что и чужой, и без флага нажавший
   * получил бы уведомление о собственном нажатии (matchNoticeDue в lib/room).
   */
  const selfCaused = useRef(false)
  const deckKey = useRef('')
  /*
   * Порядок снимков комнаты (snapshotFate в lib/roompoll): номер последнего
   * запроса и снимок на экране с номером своего запроса. refresh зовут и
   * мимо опроса, и без номера побеждал пришедший последним, а не прочитанный.
   */
  const reqSeq = useRef(0)
  const shownSnap = useRef<{ seq: number; state: RoomState } | null>(null)
  /*
   * Догнал ли опрос свои голоса (pollCaughtUp в lib/deckvote) — без этого
   * самолечение колоды срабатывало на каждом штатном конце. Счёт голосов в
   * пути и время последнего ответа — ref: их читает refresh в момент снимка;
   * сам вывод — состояние, по нему перерисовывается признак застрявшей колоды.
   */
  const votesInFlight = useRef(0)
  const votesSettledAt = useRef(0)
  const [caughtUp, setCaughtUp] = useState(false)
  const likesKey = useRef('')
  const likesAt = useRef(0)
  const likesTimer = useRef<number | null>(null)

  /** Ключ колоды, на котором уже было самолечение, — см. эффект самолечения */
  const healKey = useRef('')

  /*
   * КОЛОДА С НУЛЯ — КОГДА ЧЛЕНСТВО ПРЕРВАЛОСЬ.
   *
   * Хост убирает участника вместе со ВСЕМИ его голосами (removeRoomMember
   * стирает room_votes одной пачкой с членством), а страница этого не знала.
   * votedLocally помнил каждую отсвайпанную карту, страница не
   * перемонтируется, и после повторного входа ключ колоды возвращался ровно
   * к прежнему «состав:раунд» — колода не перечитывалась. Человек доигрывал
   * свои остатки, а карты, чьи голоса стёрты, приходили в каждом /deck и
   * каждом самолечении — и отсеивались votedLocally. Итог: у него «ждём
   * ещё одного», у остальных он «ещё свайпает» навсегда, единогласие по этим
   * картам невозможно, а «Берём» ждёт, пока отсвайпают все. Помогала только
   * перезагрузка.
   *
   * Поэтому сброс забывает всё, что колода помнит: следующий эффект видит
   * пустой ключ, грузит её как первую и получает целиком — с картами, чьи
   * голоса стёрты.
   *
   * Зовут его два места. Главное — refresh, как только снимок показал, что
   * членство прервалось (membershipLapsed в lib/deckvote): вернуться можно
   * не только своей кнопкой, но и из второй вкладки или с телефона той же
   * сессии — тогда эта вкладка просто снова видит себя участником, и без
   * сброса на опросе комната вставала так же. Второе — обе двери входа на
   * экране приглашения, страховкой: вход, который опрос не застал вовсе. На
   * первом входе сброс ничего не меняет. Голос, ушедший до удаления, вернётся
   * отказом 403 и вычеркнет из уже пустого набора — безвредно.
   *
   * useCallback без зависимостей: только рефы и сеттеры, а refresh, который
   * его зовёт, — зависимость опроса, и новый сброс на каждом рендере
   * перезапускал бы опрос.
   */
  const resetDeck = useCallback(() => {
    votedLocally.current.clear()
    deckKey.current = ''
    healKey.current = ''
    setCards(null)
    setLocalVotes(0)
    setDeckVoted(0)
    setDeckTotal(0)
    setDeckFailed(false)
    setDeckLimited(false)
    setVoteFailed(false)
  }, [])

  /**
   * ОТВЕТ РАЗБИРАЕТСЯ НА ТРИ ИСХОДА, А НЕ НА ДВА.
   *
   * Здесь возвращался `null` и на 404, и на любой другой отказ, а вызывающий
   * трактовал `null` как «комнаты нет и не появится» — комментарий в цикле так
   * и был написан, «404». Одной пятисотки хватало, чтобы опрос замолчал
   * навсегда.
   *
   * Замерено: три опроса за девять секунд, затем один ответ 500 — и НОЛЬ
   * запросов за следующие шестнадцать секунд. Комната застывала на последнем
   * снимке: ростер, голоса, колода — всё на месте и всё враньё, потому что
   * обновляться перестало. На экране при этом ни единого признака.
   *
   * Если же 500 приходил на ПЕРВЫЙ запрос, страница оставалась спиннером
   * навсегда: `state` не появлялся, а цикл уже остановился. Проверено с
   * принудительной пятисоткой в API — четырнадцать секунд спиннера и ни слова
   * о том, что произошло.
   *
   * Обрыв сети, для сравнения, всегда работал правильно: он приходит
   * исключением, попадает в catch и опрос продолжается. Замерено: шесть
   * запросов за те же шестнадцать секунд.
   */
  type Fetched = { ok: true; state: RoomState } | { ok: false; gone: boolean }

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<Fetched> => {
      // Номер и время — до запроса: порядок чтения на сервере, а не прихода
      const seq = ++reqSeq.current
      const askedAt = Date.now()
      const res = await fetch(`/api/room/${roomId}`, signal ? { signal } : {})
      if (res.status === 404) {
        setNotFound(true)
        return { ok: false, gone: true }
      }
      if (!res.ok) return { ok: false, gone: false }
      const next = (await res.json()) as RoomState
      // Снимок, прочитанный раньше показанного, или «open» после матча на
      // экран не встаёт. Вызывающему — то, что на экране: опрос по нему и
      // остановится на матче, и pullMore возьмёт ключ колоды
      const shown = shownSnap.current?.state.room.id === next.room.id ? shownSnap.current : null
      const fate = snapshotFate({
        seq,
        status: next.room.status,
        shown: shown && { seq: shown.seq, status: shown.state.room.status },
      })
      if (shown && fate === 'keep') return { ok: true, state: shown.state }
      // Хост убрал, а вернулись, может быть, уже из другой вкладки — память
      // колоды с нуля, см. resetDeck
      if (
        membershipLapsed({
          seq,
          shown: shown && { seq: shown.seq, ...membershipOf(shown.state) },
          next: membershipOf(next),
        })
      ) {
        resetDeck()
      }
      shownSnap.current = { seq, state: next }
      setState(next)
      setCaughtUp(
        pollCaughtUp({
          votesInFlight: votesInFlight.current,
          askedAt,
          votesSettledAt: votesSettledAt.current,
        }),
      )
      if (next.room.status === 'open') setSawOpen(true)
      // Матч застал вкладку скрытой — метка непрочитанного в заголовке
      // (roomTabTitle); снимает её возвращение на вкладку
      if (next.room.status === 'matched' && document.visibilityState !== 'visible') setUnseen(true)
      return { ok: true, state: next }
    },
    [roomId, resetDeck],
  )

  /**
   * Опрос состояния комнаты — подписка на внешнюю систему, ровно тот случай,
   * ради которого эффекты и существуют.
   *
   * Четыре вещи, которых тут раньше не было, и каждая стоила денег:
   * опрос не замолкал в фоновой вкладке, продолжался на экране матча (где
   * измениться уже нечему), долбился в 404 вечно и не имел защиты от наложения
   * запросов — на холодной базе ответы приходили не по порядку и счётчики в
   * ростере ехали назад. Замедление после минуты тишины держит живой ростер
   * дешёвым: разница между 2.5 и 6 секундами тут никому не видна.
   */
  useEffect(() => {
    let stopped = false
    let timer = 0
    let inFlight: AbortController | null = null
    let lastChangeAt = Date.now()
    let lastKey = ''
    /** Отказов подряд. Сбрасывается первым же успешным ответом. */
    let fails = 0
    /** С какого момента вкладка скрыта — для потолка фонового опроса */
    let hiddenSince = Date.now()
    /** Когда ушёл последний запрос — фон считает свою минуту от него */
    let askedAt = 0

    /**
     * `slow` — не оптимизация, а вежливость: когда сервер отвечает отказом,
     * долбиться в него каждые 2.5 секунды значит добавлять нагрузки ровно
     * тому, кто уже не справляется. `ms` — явный срок, у фонового опроса.
     */
    const arm = (slow = false, ms?: number) => {
      if (stopped) return
      window.clearTimeout(timer)
      const idle = Date.now() - lastChangeAt > POLL_IDLE_AFTER_MS
      timer = window.setTimeout(() => void tick(), ms ?? (slow || idle ? POLL_SLOW_MS : POLL_FAST_MS))
    }

    const tick = async (force = false) => {
      if (stopped) return
      if (inFlight) {
        arm()
        return
      }
      // В фоне по умолчанию ничего не переспрашиваем: вкладка, забытая на ночь,
      // стоила бы миллионов прочитанных строк и не показала бы никому ни одной.
      // Исключение одно — своя колода кончилась, а комната ещё может сойтись
      // без него (waitsInBackground в lib/room): тогда раз в минуту и не дольше
      // часа (hiddenPollDelay в lib/roompoll). После часа цепочка таймеров
      // обрывается, и её поднимает onVisibility.
      //
      // Первый запрос — исключение и делается всегда: ссылку на комнату
      // открывают из чата в фоновой вкладке, и без него человек, переключившись
      // на неё, упирался бы в спиннер вместо готовой страницы. Это ровно один
      // запрос, тот самый, который превращает спиннер в содержимое. Первую
      // колоду участнику эффект колоды ниже грузит по той же причине и тоже
      // из фона — дальнейшие её перечитывания ждут видимой вкладки.
      if (!force && document.visibilityState !== 'visible') {
        const every = hiddenPollDelay({
          waiting: waitingRef.current,
          hiddenForMs: Date.now() - hiddenSince,
        })
        if (every === null) {
          // Цепочка не рвётся, пока не вышел час: ждать можно начать и в
          // скрытой вкладке — ссылку открыли в фоне, колода приехала пустой
          // уже после первого тика, — и без холостого тика флаг, поднятый
          // позже, никто бы не прочёл до возвращения на вкладку. Холостой тик
          // запросов не шлёт, это только таймер. После часа — спать до onVisibility.
          if (Date.now() - hiddenSince < HIDDEN_POLL_CAP_MS) arm(true)
          return
        }
        // Отказ тоже считается запросом: сбой в фоне не ускоряет опрос
        const left = every - (Date.now() - askedAt)
        if (left > 0) {
          arm(false, left)
          return
        }
      }

      askedAt = Date.now()
      const ac = new AbortController()
      inFlight = ac
      const cap = window.setTimeout(() => ac.abort(), POLL_TIMEOUT_MS)
      try {
        const got = await refresh(ac.signal)
        // Решение — в lib/roompoll.ts и под тестом. Здесь оно применяется, а
        // не принимается: именно здесь оно однажды и оказалось неверным.
        const step = nextPollStep(
          got.ok ? { ok: true, status: got.state.room.status } : { ok: false, gone: got.gone },
          fails,
        )
        fails = step.fails
        setStale(step.stale)
        if (step.stop) {
          stopped = true
          return
        }
        if (!got.ok) {
          arm(step.slow)
          return
        }
        const next = got.state
        const key = `${next.room.status}:${next.room.deckRound}:${next.members
          .map((m) => `${m.id}${m.votes}`)
          .join(',')}`
        if (key !== lastKey) {
          lastKey = key
          lastChangeAt = Date.now()
        }
      } catch {
        // Оборванная сеть, отменённый запрос или истёкший POLL_TIMEOUT_MS.
        // Опрос здесь всегда продолжался и продолжается — замерено шесть
        // запросов за шестнадцать секунд обрыва. Не хватало ровно признака
        // на экране.
        const step = nextPollStep({ ok: false, gone: false }, fails)
        fails = step.fails
        setStale(step.stale)
      } finally {
        window.clearTimeout(cap)
        if (inFlight === ac) inFlight = null
      }
      arm()
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        hiddenSince = Date.now()
        return
      }
      if (stopped) return
      void tick()
    }

    void tick(true)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      inFlight?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const loadDeck = useCallback(async () => {
    if (deckInFlight.current) return
    deckInFlight.current = true
    setDeckFailed(false)
    try {
      const res = await fetch(`/api/room/${roomId}/deck`)
      if (!res.ok) {
        setDeckLimited(res.status === 429)
        setDeckFailed(true)
        return
      }
      const data = (await res.json()) as {
        cards: Card[]
        total: number
        votedCount: number
        hasMore: boolean
        nowSec: number
      }
      // Часы берём серверные, из того же ответа: по ним подпись онлайна решает,
      // имеет ли право сказать «сейчас». См. докблок в components/PlayersNow.
      setNowSec(data.nowSec)
      // Мержим по appid, а не заменяем: замена выдёргивает карточку из-под
      // пальца, а ownedByAll/missingFor у уже выданных карт после чужого входа
      // становятся ТОЧНЕЕ — их надо обновить, а не выбросить
      // Свои неподтверждённые голоса вычёркиваем из ответа: см. votedLocally
      const пришло = data.cards.filter((c) => !votedLocally.current.has(c.appid))
      setCards((prev) => {
        if (!prev?.length) return пришло
        const incoming = new Map(пришло.map((c) => [c.appid, c]))
        const kept = prev.map((c) => incoming.get(c.appid) ?? c)
        const seen = new Set(kept.map((c) => c.appid))
        return [...kept, ...пришло.filter((c) => !seen.has(c.appid))]
      })
      setDeckTotal(data.total)
      setDeckVoted(data.votedCount)
      setHasMore(data.hasMore)
      setLocalVotes(0)
    } catch {
      setDeckLimited(false)
      setDeckFailed(true)
    } finally {
      deckInFlight.current = false
      setPulling(false)
      setDeckLoads((n) => n + 1)
    }
  }, [roomId])

  /*
   * Ключ, а не флаг «загружено».
   *
   * Колода — функция состава комнаты и раунда: вошёл человек — она пересобрана,
   * подняли раунд — расширена. Прежний boolean-ref означал «загрузили один раз
   * и больше никогда», из-за чего поздний гость оставлял всех остальных со
   * стухшей колодой. Плюс он взводился ДО запроса, и одна ошибка сети запирала
   * участника в вечном спиннере — теперь ключ переписывается только по факту
   * попытки, а deckFailed даёт кнопку «ещё раз».
   */
  const deckWant = deckKeyOf(state)

  /*
   * Колода перечитывается только в видимой вкладке — тем же правилом, что лайки
   * ниже; первая колода — исключение (см. конец докблока).
   *
   * Скрытая ждущая вкладка опрашивает комнату раз в минуту (hiddenPollDelay в
   * lib/roompoll), и новый участник или новый раунд меняют deckWant прямо в
   * фоне. Грузи мы колоду тогда же, любой 429 или обрыв фонового запроса
   * выставлял бы deckFailed, а guard ниже по нему не повторяет: вернувшийся
   * человек видел «Не получилось загрузить игры» или «Слишком часто» вместо
   * колоды — из-за запроса, о котором он не просил и который никто не видел.
   *
   * Поэтому скрытая вкладка ключ не трогает, и первый видимый рендер (visible
   * в зависимостях) догружает колоду одним запросом. Сбрасывать deckFailed на
   * возврате было бы хуже: ключ к тому времени уже равен deckWant, эффект не
   * перезапустился бы, и человек остался бы со стухшей колодой или пустыми
   * руками, уже без кнопки «ещё раз», — а фоновый запрос всё равно тратил бы
   * rate_limits впустую. Пока колода нового раунда не догружена, пусто на
   * руках не значит «отсвайпал»: ни «ждём остальных», ни фоновый опрос
   * (deckBehind в lib/room, waitArgs ниже).
   *
   * Исключение — самая первая колода (ключ ещё пуст), тем же правилом, что
   * первый запрос опроса: ссылку на комнату открывают из чата в фоновой
   * вкладке, и участник, переключившись на неё, должен увидеть колоду, а не
   * спиннер на её месте. Этот запрос человек и просил, открыв ссылку, и он
   * один: следующие сдвиги ключа в фоне снова ждут видимости.
   *
   * Пока запрос колоды в полёте, ключ не трогается (deckInFlight): loadDeck
   * всё равно вышел бы пустышкой, а записанный ключ запер бы новый состав до
   * следующего его сдвига. Конец запроса (deckLoads) зовёт эффект снова.
   */
  const visible = useSyncExternalStore(subscribeVisibility, readVisible, serverVisible)

  useEffect(() => {
    if (!deckWant || deckKey.current === deckWant || deckFailed || deckInFlight.current) return
    if (!visible && deckKey.current !== '') return
    deckKey.current = deckWant
    void loadDeck()
  }, [deckWant, visible, deckFailed, deckLoads, loadDeck])

  /*
   * Самолечение колоды: на руках пусто, а сервер говорит, что человек не
   * дошёл до конца (deckStuck в lib/deckvote).
   *
   * Откат в vote ловит отказы, которые пришли. Этот эффект — страховка от
   * тех, что прошли мимо: колоду иначе перечитывают только при смене состава
   * или раунда, и потерянный голос держал комнату навсегда — остальные
   * видели человека «ещё свайпает», а он сам — «ждём ещё одного».
   *
   * Один раз на ключ колоды, как и сама загрузка: если сервер и после
   * перечитывания ничего не отдаст (свои голоса в пути вычёркиваются из
   * ответа — см. votedLocally), второй круг вернёт то же самое.
   *
   * И тоже только из видимой вкладки: новый раунд, поднятый соседом, делает
   * ждущего «застрявшим» ровно на фоновом опросе, и перечитывание ушло бы в
   * фон с тем же риском запереть колоду на deckFailed. Скрытая вкладка ключ
   * лечения не трогает — первый видимый рендер решит заново.
   *
   * И только когда опрос догнал свои голоса (caughtUp, pollCaughtUp в
   * lib/deckvote). Сразу после последнего свайпа на руках пусто, а done в
   * снимке ещё false — голос в пути. Без этой оговорки лечение срабатывало на
   * КАЖДОМ штатном конце колоды: полная пересборка /deck у каждого участника
   * в каждом раунде, при том что ответ ничего не менял, — и единственное
   * лечение на ключ уходило на ложную тревогу. Настоящая потеря голоса
   * дожидается ближайшего опроса после ответа на него: done там всё ещё false.
   */
  const stuck =
    caughtUp &&
    deckStuck({
      left: cards?.length ?? null,
      meDone: state?.members.find((m) => m.me)?.done,
      deckSize: state?.room.deckSize ?? null,
    })

  useEffect(() => {
    if (!stuck || !deckWant || !visible || healKey.current === deckWant) return
    healKey.current = deckWant
    void loadDeck()
  }, [stuck, deckWant, visible, loadDeck])

  /*
   * Добор раунда. finally обязателен, и вот чем он оплачен.
   *
   * Было: setPulling(true), голый await fetch и снятие флага только на !res.ok.
   * Любой обрыв сети — а докблок vote ниже прямо называет лифт и метро
   * обычным делом — отклонял промис в пустоту, и pulling оставался true до
   * перезагрузки страницы. Кнопка при этом выключена по pulling и подписана
   * «Добираю…», то есть врала, что работа идёт, и одновременно не давала
   * нажать ещё раз. А это единственный способ расшевелить застрявшую пати:
   * раунд общий и приходит всем сразу.
   *
   * refresh тоже внутри try: успешный POST с обрывом на следующем запросе
   * оставлял ровно ту же залипшую кнопку. loadDeck свои отказы ловит сам
   * (deckFailed) и флаг снимает сам, но finally здесь страхует и его.
   *
   * Ключ своего запроса пишется здесь же, и только если запрос и правда
   * уходит отсюда: эффект колоды, пока он в полёте, ключ не трогает, а после
   * — увидел бы поднятый раунд и пошёл бы за ним второй раз. Проверка флага и
   * его захват в loadDeck идут одним синхронным шагом и не разъедутся. Занят
   * флаг чужим запросом — ключ не пишется, и раунд догрузит эффект.
   */
  async function pullMore() {
    if (pulling) return
    setPulling(true)
    setPullFailed(false)
    try {
      const res = await fetch(`/api/room/${roomId}/round`, { method: 'POST' })
      if (!res.ok) throw new Error(`round: HTTP ${res.status}`)
      // Раунд поднялся на комнате — свою колоду забираем сразу, остальные
      // подхватят её на ближайшем опросе
      const got = await refresh()
      if (got.ok && !deckInFlight.current) deckKey.current = deckKeyOf(got.state)
      await loadDeck()
    } catch {
      setPullFailed(true)
    } finally {
      setPulling(false)
    }
  }

  /*
   * Лайки и почти-совпадения — отдельным запросом, а не частью опроса: перебор
   * голосов плюс метаданные игр внутри каждого тика стоили бы ровно столько же,
   * сколько мы из самого опроса убрали.
   *
   * Триггер производный: опрос и так приносит голоса всех, и пока их сумма не
   * сдвинулась, пересчитывать нечего. Пати стоит на месте — запросов ноль.
   *
   * Но это только половина правды, и вторая половина сводила первую на нет.
   * votesKey меняется РОВНО ТОГДА, когда опрос принёс новые голоса, то есть на
   * движущейся пати — каждый тик. А тик это POLL_FAST_MS, те самые 2.5 секунды.
   * Иными словами, ожидающий получал второй опрос той же частоты и с более
   * тяжёлым запросом: roomVotes по всей комнате плюс getGamesMeta. Комната из
   * восьми, где семеро дождались последнего, — это семь таких потоков разом.
   *
   * Замерено на живой комнате, счётчиком поверх window.fetch, при непрерывном
   * голосовании соседа шестьдесят с лишним секунд: 24 запроса к /likes за 63
   * секунды, промежутки — РОВНО 2.5с каждый. С полом на той же нагрузке 7
   * запросов за 78 секунд, промежутки ровно 12.0с. В пересчёте на минуту
   * 22.9 против 5.4, и это на одного ожидающего.
   *
   * Отсюда пол по частоте. Блок «вы близки» — фоновая подсказка, ей не нужна
   * секундная точность; матч приезжает опросом, а не отсюда. Первый заход
   * мгновенный (likesAt нулевой), дальше не чаще чем раз в LIKES_MIN_GAP_MS.
   *
   * Таймер хвостовой, а не гасящий: пропущенные тики схлопываются в один
   * отложенный запрос, и последнее состояние доезжает всегда. Ставится он
   * только если не стоит — иначе каждый тик отодвигал бы срок, и на непрерывно
   * свайпающей пати запрос не ушёл бы вообще ни разу.
   *
   * И только из видимой вкладки. Скрытая ждущая вкладка опрашивает комнату раз
   * в минуту (hiddenPollDelay в lib/roompoll), и чужие голоса двигают votesKey
   * почти каждым ответом — пол в 12 секунд против минутного шага не срабатывал
   * бы никогда, и к каждому фоновому GET комнаты добавлялся бы /likes: запись
   * в rate_limits, roomVotes по всей комнате и метаданные игр — ради блока «вы
   * близки», которого никто не видит. Скрытая вкладка ключ не трогает, и
   * первый же видимый рендер (visible в зависимостях) догоняет последнее
   * состояние одним запросом. Хвостовой таймер, сработавший в фоне, делает
   * то же: сбрасывает ключ и ждёт возвращения.
   */
  const waiting = Boolean(state?.isMember) && cards !== null && cards.length === 0
  const votesKey = state ? state.members.map((m) => `${m.id}${m.votes}`).join(',') : ''
  /*
   * Кого и зачем ждём — теми же правилами, что экран ожидания (waitingMode в
   * lib/room, pending в components/room/RoomWaiting): фон опрашивает комнату,
   * только если из него есть что узнать, а заголовок «Ждём остальных» стоит,
   * только пока кто-то и правда свайпает.
   *
   * deckSize — чтобы скрытая вкладка, которой сосед поднял раунд, не ждала:
   * колода нового раунда догрузится только по возвращении (эффект колоды
   * выше), и до тех пор пусто на руках не значит «отсвайпал» (deckBehind).
   */
  const waitArgs = {
    waiting,
    memberCount: state?.members.length ?? 0,
    deckTotal,
    myVotes: state?.members.find((m) => m.me)?.votes ?? 0,
    deckSize: state?.room.deckSize ?? null,
  }
  const bgWait = waitsInBackground(waitArgs)
  const awaiting = awaitingOthers({
    ...waitArgs,
    othersSwiping: state ? state.members.filter((m) => !m.me && !m.done).length : 0,
  })

  const loadLikes = useCallback(async () => {
    try {
      const res = await fetch(`/api/room/${roomId}/likes`)
      if (!res.ok) return
      const data = (await res.json()) as Partial<Likes>
      setLikes({ mine: data.mine ?? [], near: data.near ?? [], leader: data.leader ?? null })
    } catch {
      // Фоновая подсказка: следующий сдвиг голосов перечитает её сам
    }
  }, [roomId])

  useEffect(() => {
    if (!waiting || !visible || likesKey.current === votesKey) return
    likesKey.current = votesKey

    const fire = () => {
      likesTimer.current = null
      if (document.visibilityState !== 'visible') {
        likesKey.current = ''
        return
      }
      likesAt.current = Date.now()
      void loadLikes()
    }

    const left = LIKES_MIN_GAP_MS - (Date.now() - likesAt.current)
    if (left <= 0) {
      fire()
      return
    }
    if (likesTimer.current === null) likesTimer.current = window.setTimeout(fire, left)
  }, [waiting, visible, votesKey, loadLikes])

  // Снятие таймера — отдельным эффектом с пустыми зависимостями. Верни мы
  // уборку из эффекта выше, она срабатывала бы на КАЖДОЙ смене votesKey и
  // снимала хвост ровно в тот момент, ради которого он и заводится.
  useEffect(
    () => () => {
      if (likesTimer.current !== null) window.clearTimeout(likesTimer.current)
    },
    [],
  )

  useEffect(() => {
    waitingRef.current = bgWait
  }, [bgWait])

  // Вернулся на вкладку — матч увиден, точка в заголовке снимается. Отдельно
  // от опроса: на матче опрос остановлен и своего слушателя уже снял
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setUnseen(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  /*
   * Заголовок вкладки: «ждём остальных» и «сошлись» (roomTabTitle в lib/room).
   *
   * Серверный заголовок ставит React из generateMetadata, а этот пишется
   * императивно, поэтому возвращать исходный вслепую нельзя. Уборка при уходе
   * со страницы может сработать уже ПОСЛЕ того, как Next поставил заголовок
   * следующей страницы, — и слепой возврат затёр бы его заголовком комнаты.
   * Возвращаем, только если document.title всё ещё наш. То же, когда
   * состояние перестало быть нашим (добрали раунд — снова свайпает).
   */
  const tabTitle = state
    ? roomTabTitle({
        roomId,
        status: state.room.status,
        isMember: state.isMember,
        awaiting,
        sawOpen,
        unseen,
        matchedName: state.matchedGame?.name ?? null,
      })
    : null
  const titleOwn = useRef<{ original: string; ours: string } | null>(null)

  useEffect(() => {
    const own = titleOwn.current
    if (tabTitle === null) {
      if (own && document.title === own.ours) document.title = own.original
      titleOwn.current = null
      return
    }
    // Исходный — тот, что стоял до нас; наш прошлый заголовок исходным не бывает
    const original = own && document.title === own.ours ? own.original : document.title
    document.title = tabTitle
    titleOwn.current = { original, ours: tabTitle }
  }, [tabTitle])

  useEffect(
    () => () => {
      const own = titleOwn.current
      if (own && document.title === own.ours) document.title = own.original
    },
    [],
  )

  /*
   * Уведомление о матче — одно на комнату и только тому, кто просил
   * (components/room/MatchNotify). Условия новости — те же, что у matchLine:
   * своим, с игрой, и комната была открыта на глазах у этого экрана.
   */
  const matchNews =
    state?.isMember && sawOpen && state.room.status === 'matched'
      ? (state.matchedGame?.name ?? null)
      : null
  const announced = useRef(false)
  useEffect(() => {
    if (!matchNews || announced.current) return
    announced.current = true
    announceMatch({ name: matchNews, roomId, selfCaused: selfCaused.current })
  }, [matchNews, roomId])

  /*
   * Прогрев церемонии — см. докблок у MatchCeremony наверху файла. Участнику
   * открытой комнаты и в простое: первый кадр колоды важнее, а матч до него
   * всё равно не случится. Без requestIdleCallback (Safari) — таймером.
   * .catch обязателен: не пришедший кусок — не ошибка страницы (её поймал бы
   * instrumentation-client как unhandledrejection), матч покажет граница.
   */
  const warmCeremony = state?.isMember === true && state.room.status === 'open'
  useEffect(() => {
    if (!warmCeremony) return
    const warm = () => {
      loadCeremony().catch(() => null)
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 15_000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = window.setTimeout(warm, 4_000)
    return () => window.clearTimeout(t)
  }, [warmCeremony])

  // Открыл чужую комнату по приглашению — шаг воронки, раз на заход: экран
  // приглашения перерисовывается каждым опросом
  const inviteSeen = useRef(false)
  const notMember = state !== null && !state.isMember
  useEffect(() => {
    if (!notMember || inviteSeen.current) return
    inviteSeen.current = true
    track('invite_open')
  }, [notMember])

  /*
   * Вошёл по приглашению — фокус на заголовок лобби «Пати …».
   *
   * Удачный вход уносит экран приглашения вместе с нажатой кнопкой («Войти в
   * комнату», «Демо-друг»), и фокус падал в body: следующий Tab начинал с «К
   * содержанию» и шапки, а скринридер не слышал, что вход удался, — matchStatus
   * говорит только о матче. Заголовок называет новый экран, и это же ответ на
   * нажатие. Нажатия aria-disabled держат фокус на отказе, а не на удаче.
   *
   * Отметка — нажатие ЭТОЙ вкладки, ставится до запроса: опрос может принести
   * членство раньше ответа на вход, и экран уходит из-под кнопки ещё до него.
   * Отказ её не снимает — экран приглашения остаётся, членство не меняется, и
   * переносить нечего. Фокус берётся только потерянный (focusAdrift), как у
   * RoomWaiting и церемонии. Сошлась комната к этой минуте — заголовка нет
   * (ref пуст), фокус забирает церемония.
   */
  const joinHandoff = useRef(false)
  const lobbyHead = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (notMember || !joinHandoff.current) return
    joinHandoff.current = false
    if (focusAdrift(document)) lobbyHead.current?.focus()
  }, [notMember])

  /*
   * На экране ли RoomWaiting — ровно та ветка разметки, где он стоит (ниже,
   * за колодой). Считается до ранних return ради эффекта под ним.
   */
  const card = cards?.[0]
  const waitingShown = !deckFailed && cards !== null && !card
  /*
   * Фокус, упавший вместе с экраном ожидания, — на «Пустить обратно».
   *
   * ✕ отдаёт фокус соседней ✕ или заголовку (MemberRoster, RoomWaiting), а
   * через пару секунд меньший состав приносит новую колоду, и весь экран
   * ожидания уходит из-под фокуса в body. Строка отмены в эту минуту встаёт
   * над колодой (kickUndo ниже) — ближайшее к тому, что человек делал.
   *
   * Только ЭТА пересборка, а не любая смена экрана ожидания колодой (почему —
   * kickHandoffDue в lib/room): ✕ оставляет квитанцию (undoHandoff) — экран,
   * на котором нажали. Любая смена экрана ожидания её гасит, совпала она или
   * нет: второго шанса у строки нет. Когда ✕ колоды не принёс (на оставшихся
   * карт не нашлось), квитанция доживает до «Ещё 20 игр» — но раунд там уже
   * другой. И только потерянный фокус, и только когда строка есть: иначе ref
   * пуст.
   */
  const undoRef = useRef<HTMLButtonElement>(null)
  const undoHandoff = useRef<KickTicket | null>(null)
  const handOffUndo = useEffectEvent((waiting: boolean) => {
    const ticket = undoHandoff.current
    undoHandoff.current = null
    if (waiting || !state) return
    const due = kickHandoffDue(ticket, {
      members: state.members.length,
      round: state.room.deckRound,
      phase: kicked?.phase ?? null,
    })
    if (due && focusAdrift(document)) undoRef.current?.focus()
  })
  useEffect(() => {
    handOffUndo(waitingShown)
  }, [waitingShown])

  /*
   * Ответ на вход — своими словами для каждой причины.
   *
   * Роут входа отвечает 404 (комнаты нет) и 401 (сессия протухла), а клиент
   * res.ok не проверял вовсе: снимал busy и делал refresh, и на экране
   * оставался ровно тот же экран приглашения. Нажатие внешне не делало
   * НИЧЕГО и ни строчки о причине.
   */
  function joinFailure(status: number, code: string | null): string {
    if (status === 404) return 'Такой комнаты уже нет — попроси новую ссылку.'
    // 409 бывает трёх видов: комната сошлась, мест нет или хост убрал — различает код
    if (code === 'full')
      return `В пати уже ${ROOM_MAX_MEMBERS} ${plural(ROOM_MAX_MEMBERS, 'человек', 'человека', 'человек')}, больше не помещается. Собери свою.`
    // ROOM_KICK_SEC в lib/room: срок считается от того, как убрали, а не от нажатия
    if (code === 'kicked')
      return 'Хост убрал тебя из этой пати. Вернуться получится через полчаса после этого — или раньше, если хост пустит обратно. А пока можно собрать свою.'
    // Профиль сидит в комнате со входом через Steam, а здесь — ссылка (lib/roomseat)
    if (code === 'needsteam')
      return 'Этот профиль уже в пати со входом через Steam. Ссылка не доказывает, что профиль твой, — войди через Steam и здесь.'
    if (status === 409) return 'Эта пати уже договорилась об игре — попроси новую ссылку.'
    if (status === 401) return 'Сессия истекла — подключи библиотеку заново, и вернём тебя сюда.'
    if (status === 429) return 'Слишком много попыток подряд. Подожди немного и попробуй снова.'
    return 'Не получилось войти. Проверь связь и попробуй ещё раз.'
  }

  /** Отказ выхода (self) или ✕ хоста — без имени: склонять ник из Steam нельзя */
  function leaveFailure(status: number, self: boolean): string {
    if (status === 401) return 'Сессия истекла — обнови страницу и подключись заново.'
    return self
      ? 'Выйти не получилось — проверь связь и нажми ещё раз.'
      : 'Убрать из пати не получилось — проверь связь и нажми ✕ ещё раз.'
  }

  /** Код отказа из тела ответа; тело может быть и не JSON — тогда null */
  async function failureCode(res: Response): Promise<string | null> {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null
    return typeof body?.error === 'string' ? body.error : null
  }

  /*
   * То же, что join, плюс демо-библиотека первым шагом.
   *
   * Ответ /api/connect проверяется, а не выбрасывается. Раньше он
   * игнорировался, и это сходило с рук, пока /api/connect не умел отказывать:
   * теперь на нём стоит потолок, и отказ приходит кодом 429. Без проверки
   * сессия не заводилась, следующий join уходил в пустоту, кнопка гасла — и
   * человек не узнавал ничего. Отказ по потолку обязан выглядеть отказом. Тот
   * же порядок не пускает заявку на вход без библиотеки: иначе участник
   * попадал бы в комнату, из которой ему нечего предложить в колоду.
   *
   * try/finally — по той же причине, что у join ниже: обрыв сети оставлял
   * busy навсегда, и «Демо-друг» застывал на «Подключаю…».
   *
   * Вошёл демо-другом — гостем документ больше не считается (forgetGuest,
   * knownGuest в lib/sessionhint). Гостя, открывшего приглашение, отметил
   * touch из SessionKeeper, а этот вход подсказки не пишет и до нового
   * touch через двенадцать часов флаг не погасил бы никто: «Подобрать игру»
   * в шапке вело бы вошедшего через квиз на лендинг «подключать Steam», а не
   * в выдачу.
   */
  async function joinAsDemoFriend() {
    if (busy) return
    setBusy(true)
    setJoinError(null)
    joinHandoff.current = true
    try {
      const seed = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo: true, variant: 2 }),
      })
      if (!seed.ok) {
        setJoinError(
          seed.status === 429
            ? 'Слишком много попыток подряд. Подожди немного и попробуй снова.'
            : 'Не получилось завести демо-друга. Попробуй ещё раз.',
        )
        return
      }
      forgetGuest()
      const res = await fetch(`/api/room/${roomId}/join`, { method: 'POST' })
      if (!res.ok) {
        setJoinError(joinFailure(res.status, await failureCode(res)))
        return
      }
      resetDeck()
      void refresh()
    } catch {
      setJoinError(joinFailure(0, null))
    } finally {
      setBusy(false)
    }
  }

  /*
   * Вход в комнату по приглашению.
   *
   * Было: setBusy(true), голый await, снятие флага без try. Обрыв сети
   * оставлял busy=true навсегда, а кнопки экрана выключены по busy —
   * то есть единственное действие страницы-приглашения умирало от одного
   * моргнувшего вайфая. Отказы роута теперь названы — см. joinFailure.
   */
  async function join() {
    if (busy) return
    setBusy(true)
    setJoinError(null)
    joinHandoff.current = true
    try {
      const res = await fetch(`/api/room/${roomId}/join`, { method: 'POST' })
      if (!res.ok) {
        setJoinError(joinFailure(res.status, await failureCode(res)))
        return
      }
      // Повторный вход после удаления — колода с нуля, см. resetDeck
      resetDeck()
      void refresh()
    } catch {
      setJoinError(joinFailure(0, null))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Голос за карточку.
   *
   * Оптимистично: карта улетает и счётчик растёт до ответа — иначе свайп
   * ощущается как залипание. Но оптимизм обязан УМЕТЬ ОТКАТЫВАТЬСЯ, и
   * раньше не умел: `if (!res.ok) return` и отсутствие catch съедали и
   * отказ сервера, и обрыв сети молча. Карта при этом уже выброшена, а
   * счётчик увеличен.
   *
   * Цена той тишины считается на троих. У проголосовавшего колода пустеет и
   * экран говорит «все отсвайпали — и ни разу не совпали». У остальных
   * ростер навсегда стоит на 9 из 10, потому что его голоса в базе нет.
   * А сама игра матчем уже не станет никогда: второй раз её никто не
   * увидит. Обрыв связи на телефоне — не исключительная ситуация, это
   * лифт и метро.
   *
   * Поэтому отказ возвращает карту на место и отматывает счётчик, а строка
   * под колодой честно говорит, что голос не ушёл. Но только тот отказ,
   * который повтор может исправить, — разбор кодов в voteMiss (lib/deckvote).
   */
  async function vote(card: Card, yes: boolean) {
    // Второй жест по той же карте — пустышка: двойной Enter по улетающей
    // карте голосовал дважды, см. claimVote. Отказ ниже вычёркивает карту
    // обратно, и повтор после сбоя проходит.
    if (!claimVote(votedLocally.current, card.appid)) return
    // Голос в пути: снимок опроса о нём не знает, и пустые руки сейчас — не
    // «застряла колода» (pollCaughtUp в lib/deckvote, самолечение выше)
    votesInFlight.current += 1
    setCaughtUp(false)
    // Прежний отказ гаснет с новой попыткой. Иначе второй отказ подряд пришёл
    // бы тем же текстом — а это не изменение, и строка под колодой промолчала
    // бы (components/StatusLine); пока голос в пути, под следующей картой
    // висело бы «вернулась» про прошлую.
    setVoteFailed(false)
    setCards((prev) => (prev ? prev.filter((c) => c.appid !== card.appid) : prev))
    setLocalVotes((v) => v + 1)
    // 0 — ответа нет: обрыв сети, VOTE_TIMEOUT_MS или неразборчивое тело
    let status = 0
    try {
      const res = await fetch(`/api/room/${roomId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: card.appid, vote: yes }),
        signal: voteSignal(),
      })
      // Проверка res.ok нужна и сама по себе: без неё любая ошибка давала
      // data.matched === undefined, а undefined !== null истинно — и каждый
      // сбой дёргал лишний опрос.
      if (res.ok) {
        const data = (await res.json()) as { matched: number | null }
        setVoteFailed(false)
        if (data.matched !== null) {
          // Матч сошёлся на этом голосе — новость для остальных, не для него
          selfCaused.current = true
          void refresh()
        }
        return
      }
      status = res.status
    } catch {
      // разбор ниже, со статусом 0
    } finally {
      // Исход голоса известен: снимок, запрошенный после этой минуты, его знает
      votesInFlight.current -= 1
      votesSettledAt.current = Date.now()
    }

    switch (voteMiss(status)) {
      case 'gone':
        // 409 — голос не примут и со второй попытки: комната уже договорилась
        // (matched) или карты нет среди розданных (notindeck). Возвращать такую
        // карточку в колоду значит предложить жест, который снова откажет.
        // Карта уходит, а опрос сразу же узнаёт, что в комнате: при матче это
        // и есть церемония.
        setVoteFailed(false)
        void refresh()
        return
      case 'bounce':
        // 401 — сессия истекла, и «свайпни ещё раз» откажет так же. Карточка
        // входа знает и этот код, и комнату: после входа вернёт сюда же.
        votedLocally.current.delete(card.appid)
        router.push(`/?join=${roomId}&error=nosession`)
        return
      case 'removed':
        // 403 — хост убрал из комнаты. Карта не возвращается: голосовать
        // здесь больше нельзя, а опрос покажет экран приглашения. Сервер при
        // этом стёр ВСЕ голоса участника, не только этот, — поэтому снимок
        // без членства, который принесёт refresh ниже, сбрасывает набор и
        // колоду целиком (resetDeck). Здесь — только этот голос: его нет, и
        // счётчик его не держит.
        votedLocally.current.delete(card.appid)
        setLocalVotes((v) => Math.max(0, v - 1))
        setVoteFailed(false)
        void refresh()
        return
      case 'retry':
        // В голову колоды, а не в хвост: карточка возвращается туда, где её
        // только что видели, и повтор — это тот же жест ещё раз.
        setCards((prev) => (prev ? [card, ...prev.filter((c) => c.appid !== card.appid)] : prev))
        // Карта вернулась намеренно — прятать её от следующего /deck нельзя
        votedLocally.current.delete(card.appid)
        setLocalVotes((v) => Math.max(0, v - 1))
        setVoteFailed(true)
    }
  }

  /**
   * «Берём «X»?» — комната соглашается на лидера голосов (leader/route.ts).
   *
   * Матч приезжает тем же опросом, что и единогласный, поэтому после успеха —
   * сразу refresh: церемония появится у нажавшего без паузы, у остальных — на
   * ближайшем тике. 409 matched — комната уже договорилась, и опрос покажет о
   * чём. 409 noleader — голоса сдвинулись, пока человек нажимал (кто-то вышел
   * или взял ещё игр): предложение перечитывается, а строка под кнопкой
   * говорит, почему нажатие не сработало. Молча погасшая кнопка читалась бы
   * как сломанная.
   */
  async function takeLeader() {
    const leader = likes.leader
    if (!leader || takingLeader) return
    setTakingLeader(true)
    setLeaderMiss(null)
    try {
      const res = await fetch(`/api/room/${roomId}/leader`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: leader.appid }),
      })
      const data = res.ok ? {} : ((await res.json().catch(() => ({}))) as { error?: string })
      // «matched» — комнату свели до этого нажатия, матч чужой
      if (res.ok) selfCaused.current = true
      if (res.ok || data.error === 'matched') {
        // Матч уже записан: сбой этого чтения — не отказ «Берём», его
        // подхватит обычный опрос
        await refresh().catch(() => null)
        return
      }
      if (data.error === 'noleader') {
        setLeaderMiss('stale')
        await loadLikes()
        return
      }
      setLeaderMiss('failed')
    } catch {
      setLeaderMiss('failed')
    } finally {
      setTakingLeader(false)
    }
  }

  /**
   * Убрать участника — или уйти самому, если memberId не назван.
   *
   * Знаменатель единогласия это число участников (findRoomMatch), а DELETE
   * из room_members до сих пор не существовало нигде. Один вошедший и
   * закрывший вкладку запирал комнату навсегда, и остальные вечно читали
   * «сошлись на N играх, ждём третьего». Сам он кнопку уже не нажмёт —
   * поэтому рука хоста тут не украшение, а единственный выход.
   *
   * Наружу уходит ХЕШ участника, не steamid: см. шапку lib/room.ts.
   *
   * Отказ — строкой у «Выйти из пати» (leaveMiss в RoomWaiting), а не
   * тишиной: раньше на моргнувшей связи нажатие не меняло ничего, и человек,
   * уверенный, что вышел, оставался в знаменателе единогласия. Повтор, пока
   * запрос в пути, гасит leaving; прежний отказ гаснет до первого await —
   * иначе второй такой же промолчал бы (components/StatusLine). Сервер
   * повтор и так прощает (повторный выход — не ошибка, повторное ✕ по
   * ушедшему — removed: false), так что флаг — ради честного вида кнопок, а
   * не ради данных.
   *
   * Поэтому флаг держится ровно на POST и не дольше. У запроса потолок
   * (cappedSignal): без него повисший POST оставлял «Выйти из пати» и все ✕
   * aria-disabled пустышками без строки отказа. Перечитывание после ✕ никто
   * не ждёт: раньше await здесь держал leaving до нового ростера только ради
   * переноса фокуса в MemberRoster, а тот теперь сам держит перенос, пока
   * строка на месте, и забывает его на отказе этой ✕ (missedMember).
   */
  async function removeMember(memberId?: string) {
    if (leaving) return
    setLeaving(true)
    setLeaveMiss(null)
    // Прежний отказ гаснет до запроса: второй такой же иначе промолчал бы
    // (components/StatusLine) — область в шапке меняет только содержимое
    setPublicDenied(false)
    const name = memberId ? state?.members.find((m) => m.id === memberId)?.name : undefined
    // Экран, на котором нажали: отказ живёт, пока он тот же (roomMissText)
    const deck = deckKeyOf(state)
    try {
      const res = await fetch(`/api/room/${roomId}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memberId ? { memberId } : {}),
        signal: cappedSignal(POLL_TIMEOUT_MS),
      })
      if (await isNeedSteam(res)) {
        // Убрать другого — право хоста со входом через Steam (leave/route.ts).
        // Хост по ссылке бывает: рука переходит к участнику по ссылке, когда
        // хост уходит. Ему — та же строка, что у доски, а не молча погасший крестик
        writerStore.set(false)
        setPublicDenied(true)
        return
      }
      if (!res.ok) {
        setLeaveMiss({ text: leaveFailure(res.status, !memberId), deck, memberId })
        return
      }
      // Ушёл сам — на доску, там есть куда подсесть. Убрал другого — остаёмся
      // и перечитываем: матч мог стать достижим прямо этим действием. Сбой
      // этого чтения — не отказ удаления: его подхватит обычный опрос
      if (memberId) {
        setKicked({ id: memberId, name: name ?? 'участник', phase: 'shown' })
        // Квитанция фокуса (handOffUndo): экран, на котором нажали. state —
        // снимок того рендера, и await его не сдвигает
        if (state) undoHandoff.current = { members: state.members.length, round: state.room.deckRound }
        void refresh().catch(() => null)
      } else router.push('/rooms')
    } catch {
      setLeaveMiss({ text: leaveFailure(0, !memberId), deck, memberId })
    } finally {
      setLeaving(false)
    }
  }

  /** Повтор гасит unkick: в пути — ждём ответа, снят — снимать нечего */
  const undoLocked = kicked?.phase === 'busy' || kicked?.phase === 'done'

  /**
   * «Пустить обратно» — снять с убранного запрет на возвращение.
   *
   * В ростер это его не сажает: войти — его дело, «Войти в комнату» у него
   * на экране. needsteam — та же строка в шапке, что у ✕: права те же.
   */
  async function unkick() {
    if (!kicked || undoLocked) return
    const { id } = kicked
    setKicked({ ...kicked, phase: 'busy' })
    setPublicDenied(false)
    const res = await fetch(`/api/room/${roomId}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unkick: id }),
      // Потолок, как у ✕ и доски: фаза 'busy' держит undoLocked, и кроме
      // ответа её не гасит ничто. Отмена по сроку уходит в catch — 'failed'
      signal: cappedSignal(POLL_TIMEOUT_MS),
    }).catch(() => null)
    const denied = res !== null && (await isNeedSteam(res))
    if (denied) {
      writerStore.set(false)
      setPublicDenied(true)
    }
    // Ответ мог прийти, когда строка уже про другого убранного
    const phase = denied ? 'shown' : res?.ok ? 'done' : 'failed'
    setKicked((k) => (k?.id === id ? { ...k, phase } : k))
  }

  /*
   * Доска «Пати» — вкл/выкл. Отказ сети раньше уходил в refresh, который сам
   * падал необработанным отказом промиса, а кнопка не отвечала ничем.
   * Теперь строка (publicMiss): под шапкой, а при AloneInvite — под его
   * плиткой, потому что кнопки шапки тогда спрятаны. needsteam — своя строка
   * о входе (NeedSteam), 429 — своя строка о потолке частоты: «нажми ещё раз»
   * упиралось бы в тот же потолок (publicFailure в lib/room). Перечитываем и
   * после отказа: переключатель рисует то, что на сервере, а не то, что нажали.
   *
   * Перечитывание здесь ждут — в отличие от ✕: следующее нажатие шлёт
   * «противоположное тому, что на экране», и переключатель, отпущенный до
   * нового снимка, на быстром втором тапе отправил бы то же значение ещё раз
   * вместо обратного. Но у обоих запросов потолок (cappedSignal): без него
   * повисший POST или GET держал publicBusy, и тумблер был aria-disabled
   * пустышкой без строки отказа, пока браузер сам не сдастся.
   */
  async function togglePublic() {
    if (publicBusy) return
    setPublicBusy(true)
    setPublicMiss(null)
    // Прежний отказ гаснет до запроса, как у ✕ и «Пустить обратно»: второй
    // needsteam подряд иначе не менял бы область в шапке и промолчал бы
    // (components/StatusLine), а вход через Steam в другой вкладке оставлял
    // бы над переключённой доской строку «войди через Steam»
    setPublicDenied(false)
    const was = state?.room.isPublic ?? false
    // Экран — на минуту нажатия, текст — по ответу: 429 просит подождать, а
    // не нажать ещё раз (publicFailure в lib/room)
    const deck = deckKeyOf(state)
    const missOf = (status: number): RoomMiss => ({ text: publicFailure(status), deck, wasPublic: was })
    try {
      const res = await fetch(`/api/room/${roomId}/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: !was }),
        signal: cappedSignal(POLL_TIMEOUT_MS),
      })
      if (await isNeedSteam(res)) {
        writerStore.set(false)
        setPublicDenied(true)
        return
      }
      if (!res.ok) setPublicMiss(missOf(res.status))
      await refresh(cappedSignal(POLL_TIMEOUT_MS)).catch(() => null)
    } catch {
      setPublicMiss(missOf(0))
    } finally {
      setPublicBusy(false)
    }
  }

  if (notFound) {
    return (
      <Notice
        title="Такой комнаты нет"
        body="Код с опечаткой или комната уже закрылась. Новая собирается за минуту — и ссылку на неё можно сразу кинуть своим."
      >
        <Link href="/room/new" className="btn-ember px-6 py-3">
          Создать свою
        </Link>
        <Link href="/rooms" className="btn-glass">
          <Icon name="users" size={18} />
          Подсесть к открытой пати
        </Link>
      </Notice>
    )
  }

  /*
   * СПИННЕР ЖДЁТ ПЕРВЫЙ ОТВЕТ, А НЕ ВЕЧНОСТЬ.
   *
   * Если первый же запрос отказал, `state` не появится никогда. Замерено с
   * принудительной пятисоткой в API: четырнадцать секунд спиннера и ни слова о
   * том, что произошло. Опрос при этом продолжается — так что экран честно
   * говорит «пробую снова», а не предлагает жать кнопку.
   */
  if (!state) {
    if (stale) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
          <p className="font-display text-display-sm">Комната не отвечает</p>
          <p className="text-dim text-sm max-w-md leading-relaxed">
            Сервер молчит или связь оборвалась. Пробую снова — если комната жива, она появится
            сама.
          </p>
          <Link href="/rooms" className="tap link-more">
            Ко всем комнатам
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      )
    }
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  /*
   * ПЛАШКА УСТАРЕВАНИЯ ЛЕЖИТ В ПОТОКЕ, А НЕ ПОВЕРХ.
   *
   * Первая версия висела `fixed` под шапкой и на снимке накрыла заголовок
   * комнаты и обе кнопки — то есть сообщение о том, что данные врут, само
   * закрыло данные. В потоке столкнуться ей не с чем: контейнер комнаты и так
   * колонка.
   *
   * Последний снимок при этом остаётся на экране целиком: он всё ещё полезен —
   * колода, ростер, кто голосовал. Врал он ровно тем, что выглядел свежим.
   * Плашка это и снимает, ничего не пряча.
   *
   * Живая область — новость приходит без действия человека, и без
   * объявления её не заметит тот, кто не смотрит на экран. Стоит всегда, а
   * не появляется вместе с плашкой: область, вставленная уже с текстом,
   * звучит не везде (components/StatusLine).
   */
  const staleBadge = (
    <StatusLine
      text={stale ? 'Связь потеряна — комната не обновляется. Пробую снова…' : null}
      className="panel-lift anim-rise px-4 py-2.5 text-xs leading-relaxed text-dim"
    />
  )

  /*
   * МАТЧ ОБЪЯВЛЯЕТ СТРАНИЦА, А НЕ ЦЕРЕМОНИЯ.
   *
   * Матч приходит опросом — чужим последним голосом или чужим «Берём», — и
   * церемония заменяет комнату целиком: колода и её живая область уходят,
   * фокус падает в body. Незрячий участник не узнавал, что матч случился.
   * Внутри MatchCeremony строка родилась бы вместе с текстом и звучала бы не
   * везде (components/StatusLine), поэтому она стоит первым ребёнком
   * фрагмента в обоих return — лобби и церемонии: React сверяет детей по
   * месту, и узел переживает подмену. Поставь что-нибудь над ней в одном из
   * них — и область смонтируется заново вместе с текстом (сторож —
   * lib/focushandoff.test.ts).
   */
  const matchStatus = (
    <StatusLine
      text={matchLine({
        sawOpen,
        status: state.room.status,
        isMember: state.isMember,
        game: state.matchedGame,
      })}
      className="sr-only"
    />
  )

  // ---- МАТЧ ----
  /*
   * Церемония — только своим.
   *
   * Она рисовалась до проверки членства, и друг, открывший приглашение через
   * час после того, как двое договорились, видел «Это матч! Все в комнате
   * хотят играть в одно и то же» и «Зови всех в войс — договорились же» —
   * чужой праздник на игре, которой у него может и не быть. Войти он уже не
   * может (join отвечает 409), поэтому ему — что случилось и куда дальше.
   *
   * И где взять игру. Сюда же приходит весть «Играем в X» с экрана матча
   * (components/room/MatchShare, ref=match) — тем, кто опоздал к выбору, — и
   * такому другу чаще всего надо её купить или поставить. Без ссылки на игру
   * экран предлагал ему только свою комнату и чужие пати: не тот следующий
   * шаг ровно для того, кому весть и кидали. Ссылка тихая, над абзацем, а не
   * второй кнопкой: открывший старое приглашение пришёл выбирать, и ему
   * по-прежнему главное — своя комната. Сверх названия из заголовка она
   * ничего не раскрывает: адрес магазина API отдаёт и не участнику.
   */
  if (state.room.status === 'matched' && state.matchedGame && !state.isMember) {
    const shop = storeLink(state.matchedGame)
    return (
      <div className="relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
        <Ambient />
        <div className="relative max-w-md w-full panel-lift p-8 text-center flex flex-col gap-4 anim-rise">
          <h1 className="font-display text-display-sm">
            Эта пати уже договорилась: «{state.matchedGame.name}»
          </h1>
          {shop && (
            <a
              href={shop.href}
              target="_blank"
              rel="noreferrer"
              className="tap text-sm text-dim hover:text-ink transition-colors"
            >
              Открыть «{state.matchedGame.name}» в {shop.where}
            </a>
          )}
          {/*
            Не-участник — не всегда чужой: профиль, сидящий здесь со входом
            через Steam, открытый по вставленной ссылке, опрос тоже отдаёт
            не-участником (needSteam, lib/roomseat). Весть «Играем в X»
            (MatchShare) приходит в чат этим адресом, и свой с телефона читал
            «новых людей не пускают» — что его в пати нет. Ему — вход через
            Steam, как на приглашении ниже: join своего в сошедшуюся комнату
            пускает (joinRoom), и возврат откроет церемонию.
          */}
          {state.needSteam ? (
            <>
              <p className="text-dim text-sm">
                Комната <span className="font-mono text-ink">{roomId}</span>. Этот профиль в ней — со
                входом через Steam, а ссылка не доказывает, что он твой: войди через Steam и здесь, и
                откроется экран матча.
              </p>
              <a href={`/api/auth/steam?join=${roomId}`} className="btn-ember is-block py-3">
                Войти через Steam
              </a>
            </>
          ) : (
            <>
              <p className="text-dim text-sm">
                Комната <span className="font-mono text-ink">{roomId}</span> сошлась, и новых людей в
                неё уже не пускают. Собери свою — или подсядь к тем, кто ещё выбирает.
              </p>
              <Link href="/room/new" className="btn-ember is-block py-3">
                Создать свою комнату
              </Link>
              <Link href="/rooms" className="tap link-more">
                Открытые пати
                <Icon name="arrow" size={16} />
              </Link>
            </>
          )}
        </div>
      </div>
    )
  }
  if (state.room.status === 'matched' && state.matchedGame) {
    return (
      <>
        {matchStatus}
        <MatchCeremony
          game={state.matchedGame}
          memberCount={state.members.length}
          roomId={roomId}
          takeFocus={sawOpen}
        />
      </>
    )
  }

  /*
   * Настроение выбирал хост при создании, и колода собрана под него. Одна
   * строка на шапку комнаты и на экран приглашения: друг, которому в чате
   * пришло «Серёга зовёт: пара быстрых каток», обязан увидеть тот же вечер
   * и до входа, а не узнать о нём уже над колодой.
   */
  const moodPreset = roomPresetOf(state.room.mood)
  const moodLine = moodPreset && (
    <p className="text-xs text-dim mt-0.5">
      <span aria-hidden>{moodPreset.emoji}</span> {moodPreset.label}
    </p>
  )

  // ---- НЕ УЧАСТНИК ----
  if (!state.isMember) {
    /*
     * Экран говорит то же, что карточка в чате: кто зовёт, на какой вечер,
     * кто уже здесь и во что звали. Раньше здесь были только «Тебя зовут» и
     * код — то, ради чего друг нажал карточку, экран забывал ровно в минуту
     * решения. Строки собирает сервер (inviteDoor): страница стоит у потолка
     * первой загрузки, и её скрипт только расставляет их. Нет строк (старый
     * ответ, needSteam) — прежний заголовок.
     */
    const door = state.invite
    return (
      <div className="relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
        <Ambient />
        <div className="relative max-w-md w-full panel-lift p-8 text-center flex flex-col gap-4 anim-rise">
          <h1 className="font-display text-display-sm">{door?.title ?? 'Тебя зовут выбрать игру на вечер'}</h1>
          {moodLine}
          {/* Карта, с которой начнётся колода, — картинкой, как фон превью.
              Без арта — одна строка: заглушка с названием повторила бы его */}
          {door?.seed && (
            <div className="flex items-center gap-3 text-left text-sm">
              <GameArt
                appid={door.seed.appid}
                name={door.seed.name}
                headerImage={door.seed.headerImage}
                art={door.seed.art}
                sizes="96px"
                fallback={null}
                className="w-24 shrink-0 rounded-md"
              />
              {door.seed.line}
            </div>
          )}
          {door?.here && <p className="text-sm">{door.here}</p>}
          {/*
            С сессией библиотека уже подключена, и «подключи» над кнопкой
            «Войти в комнату» читалось так, будто вход не сработал. Сюда с
            сессией теперь попадают реже — вход по приглашению сажает в
            комнату сам, — но ссылку открывают и уже вошедшие.

            Слова без рода: «Здесь вход по ссылке», а не «ты зашёл», «не против
            сыграть», а не «готов играть». Род того, кто смотрит на экран, нам
            неизвестен так же, как род ника (RoomWaiting, AloneInvite);
            сторож — lib/roomlikes.test.ts.
          */}
          <p className="text-dim text-sm">
            Комната <span className="font-mono text-ink">{roomId}</span>.{' '}
            {state.needSteam
              ? 'Этот профиль уже в пати — со входом через Steam. Здесь вход по ссылке, а она не доказывает, что профиль твой: войди через Steam и здесь, и продолжишь с того же места.'
              : state.hasSession
                ? 'Библиотека уже подключена — осталось войти и свайпать, во что не против сыграть. Совпадёте — будет матч.'
                : 'Подключи свою библиотеку — и свайпай, во что не против сыграть. Совпадёте — будет матч.'}
          </p>
          {/*
            aria-disabled, а не disabled, у обеих дверей: на отказе экран
            остаётся, строка ниже говорит почему, и нажатая кнопка обязана
            удержать фокус — disabled ронял его в body на всё время запроса.
            Повтор гасят сами join и joinAsDemoFriend (по busy).

            needSteam — первой веткой: «Войти в комнату» такой сессии откажет
            (lib/roomseat), и кнопка, отвечающая отказом, хуже честной двери.
            Возврат из Steam сам посадит в комнату и поднимет членство.
          */}
          {state.needSteam ? (
            <a href={`/api/auth/steam?join=${roomId}`} className="btn-ember is-block py-3">
              Войти через Steam
            </a>
          ) : state.hasSession ? (
            <button
              onClick={join}
              aria-disabled={busy}
              className="btn-ember is-block py-3"
            >
              Войти в комнату
            </button>
          ) : (
            <>
              <a
                href={`/api/auth/steam?join=${roomId}`}
                className="btn-ember is-block py-3"
              >
                Войти через Steam
              </a>
              <Link
                href={`/?join=${roomId}`}
                className="btn-glass flex w-full"
              >
                Вставить ссылку на профиль
              </Link>
              <button
                onClick={joinAsDemoFriend}
                aria-disabled={busy}
                className="tap text-sm text-dim hover:text-ink transition-colors"
              >
                {busy ? 'Подключаю…' : 'Демо-друг (без Steam)'}
              </button>
            </>
          )}
          {/*
            Под обеими ветками, а не только под демо-другом: обычный вход тоже
            умеет отказывать, и прежде экран молчал на все его отказы одинаково.
            Строка стоит всегда, пустой: join сбрасывает прежний отказ, и новый
            приходит в неё изменением текста — такое скринридер объявит.
          */}
          <StatusLine text={joinError} className="anim-rise text-sm text-danger" />
        </div>
      </div>
    )
  }

  // ---- ЛОББИ + СВАЙП ----

  /*
   * «Пустить обратно» — под ростером, откуда нажат ✕ (RoomWaiting ставит её
   * и под приглашением, если ✕ убрал последнего, кроме хоста). Пропадает,
   * когда убранный снова в ростере: отменять уже нечего.
   *
   * Экран ожидания ✕ сам и уводит: меньший состав — новая колода, и SwipeDeck
   * встаёт на его место. Тогда строку ставит страница — под составом над
   * колодой (waitingShown). Одно условие на обе развилки: строка не
   * пропадает и не стоит дважды.
   *
   * Имя после двоеточия, а глагол — без рода: «убрали», «сможет». Ник из
   * Steam не склоняется и рода не выдаёт (тот же довод — в LikesStrips).
   */
  const kickShown = kicked && !state.members.some((m) => m.id === kicked.id) ? kicked : null
  // Кнопка — в строку за фразой, а не флекс-элементом: флекс с переносом
  // ставил её третьим рядом под переносом фразы. Над колодой на телефоне
  // строка — ровно один ряд: фраза в своём span обрезается многоточием, а
  // кнопка целиком (kick-undo в globals.css) — каждый ряд там отнят у карты
  const kickUndo = kickShown ? (
    <p className="relative text-xs text-faint">
      <span>
        {kickShown.phase === 'done'
          ? `${kickShown.name} сможет войти сразу.`
          : `Убрали из пати: ${kickShown.name}. Войти снова получится через полчаса.`}
      </span>{' '}
      <button
        ref={undoRef}
        type="button"
        onClick={() => void unkick()}
        aria-disabled={undoLocked}
        className="tap tap-tight ml-1 text-ember-text hover:underline cursor-pointer aria-disabled:opacity-60 aria-disabled:no-underline"
      >
        {kickShown.phase === 'busy'
          ? 'Пускаю…'
          : kickShown.phase === 'done'
            ? 'Пустили обратно'
            : kickShown.phase === 'failed'
              ? 'Не дошло — нажми ещё раз'
              : 'Пустить обратно'}
      </button>
    </p>
  ) : null
  // Прогресс приходит с сервера (он один знает, сколько карт осталось после
  // фильтра актуальности), но свайп обязан двигать полосу мгновенно, а опрос
  // отстаёт на пару секунд
  const votedCount = deckVoted + localVotes
  const alone = state.members.length <= 1
  // Ровно то условие, при котором ниже рендерится RoomWaiting с AloneInvite:
  // колода загружена и пуста, а waitingMode отдаёт 'alone'
  const aloneInvite = alone && waitingShown
  // Отказы кнопок — пока они правда (roomMissText в lib/room)
  const missNow = { deck: deckWant, members: state.members, isPublic: state.room.isPublic }
  const publicMissText = roomMissText(publicMiss, missNow)
  const leaveMissText = roomMissText(leaveMiss, missNow)

  return (
    <>
    {matchStatus}
    <div className="room-page flex-1 mx-auto w-full max-w-3xl px-5 pt-24 pb-16 flex flex-col gap-6">
      {staleBadge}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {/* Цель фокуса после входа по приглашению — joinHandoff */}
          <h1 ref={lobbyHead} tabIndex={-1} className="font-display text-display-sm">
            Пати <span className="font-mono text-ember-text">{roomId}</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            {alone ? 'Матч нужен минимум вдвоём' : 'Совпадут голоса всех — будет матч'}
          </p>
          {/* Настроение — той же строкой, что на экране приглашения (moodLine) */}
          {moodLine}
        </div>
        {/*
          Кнопки прячутся, когда внизу уже стоит AloneInvite.

          Он показывается, когда колода загружена и пуста, а в комнате один
          человек (waitingMode отдаёт 'alone' при memberCount <= 1), и до этой
          правки одинокий хост видел ЧЕТЫРЕ кнопки на ДВА действия: обе пары дёргают одни и те же обработчики.
          Названы они при этом по-разному — копирование «Скопировать ссылку для
          друзей» вверху и «Позвать своих» внизу, публичность «Показать на
          доске» вверху и «Пустить чужих» внизу. Флаг copied к тому же общий, и
          нажатие одной зажигало галочку сразу на обеих: человек своими глазами
          видел, что это один орган управления под двумя именами.

          Прячем ВЕРХНИЕ, а не нижние: AloneInvite ровно для этого случая и
          написан — там развилка «позвать своих или пустить чужих», код комнаты
          героем и запасное поле со ссылкой на случай отказа буфера.

          Пока колода грузится или не загрузилась, AloneInvite нет — и верхние
          кнопки стоят: иначе у одинокого хоста не осталось бы ни одной.
        */}
        <div className={`flex items-center gap-2 flex-wrap ${aloneInvite ? 'hidden' : ''}`}>
          {/*
            Ссылка ПЕРЕД доской, а не после.

            Порядок был обратный: сначала тумблер «показывать на доске», потом
            кнопка «скопировать ссылку». То есть настройка стояла впереди
            действия — притом что подзаголовок этой же страницы говорит «матч
            нужен минимум вдвоём», а /rooms раскладывает порядок по шагам:
            «Создай комнату», потом «Кинь ссылку своим», и только ниже —
            доска открытых пати. Позвать своих — основной путь, доска —
            запасной, и вёрстка обязана читаться так же.
          */}
          {/*
            У этой кнопки нет соседнего поля со ссылкой — она стоит в ряду
            действий шапки. Поэтому когда буфер закрыт наглухо, она отсылает к тому,
            что на экране и так есть: код комнаты стоит слева в заголовке, и по нему
            заходят так же, как по ссылке. Молчаливое нажатие читалось бы как
            сломанная кнопка.
          */}
          {/*
            На телефоне подписи короче, и это не косметика. Полные две кнопки
            не влезают в строку на 390 px и встают в два ряда — замер: карта
            колоды начиналась на 329 px вместо 277, и кнопки голоса уходили
            под нижнюю панель (на 19 px на 390×844, на 113 на 375×667). Высота
            карты (.room-page .deck-stack) считается от шапки в один ряд — и
            от состава над колодой в один ряд (ниже, у его разметки).
          */}
          <button onClick={copyLink} className="btn-glass py-3 text-sm">
            {share.label(
              <>
                <span className="md:hidden">Ссылка для друзей</span>
                <span className="hidden md:inline">Скопировать ссылку для друзей</span>
              </>,
              {
                icon: 'link',
                native: (
                  <>
                    <span className="md:hidden">Позвать друзей</span>
                    <span className="hidden md:inline">Отправить ссылку друзьям</span>
                  </>
                ),
                manual: 'Не вышло — продиктуй код',
              },
            )}
          </button>
          {/* Живая область — рядом с кнопкой: внутри она стала бы частью её имени */}
          {share.status}
          {/*
            Индикатор отделён от переключателя.

            Раньше всё это было под state.isHost, то есть гость не знал, что
            комната открыта на доске и его ник виден на /rooms. Сервер отдаёт
            isPublic всем (app/api/room/[id]/route.ts) — скрыта была только
            отрисовка. Хост включает публичность в любой момент, в том числе
            уже после того, как гость вошёл.

            Управление остаётся хосту: снять комнату с доски может только он
            (роут отвечает nothost остальным), и кнопка, отвечающая отказом,
            хуже её отсутствия.
          */}
          {state.isHost ? (
            <button
              onClick={togglePublic}
              aria-pressed={state.room.isPublic}
              // aria-disabled, а не disabled: фокус остаётся на кнопке, пока
              // запрос в пути. Повтор гасит togglePublic (по publicBusy)
              aria-disabled={publicBusy}
              /* py-3, а не py-2: замерено — 38 px при стандарте продукта в 44
                 (докблок .tap). Утилитой .tap не чинится: её зона вылезает на
                 6 px вбок, а соседняя кнопка стоит в 8 — зоны перекрылись бы и
                 воровали друг у друга нажатия. Это единственные два контрола,
                 которыми в пати вообще зовут людей. */
              className="btn-glass py-3 text-sm"
              title="Открытая комната видна на доске «Пати» — к вам смогут подсесть"
            >
              <Icon name={state.room.isPublic ? 'check' : 'users'} size={16} />
              {state.room.isPublic ? (
                'На доске'
              ) : (
                <>
                  <span className="md:hidden">На доску</span>
                  <span className="hidden md:inline">Показать на доске</span>
                </>
              )}
            </button>
          ) : state.room.isPublic ? (
            /*
              Факт — текстом, а не подсказкой. Он и был смыслом индикатора («ник
              виден на /rooms»), но жил только в title на неактивном span:
              тач-браузеры title не показывают вовсе, скринридеры на простом
              span — через раз. Телефон-первый продукт показывал гостю «На
              доске» без единого слова о том, что на доске — он сам.
              «Ты на доске» — о человеке, а не о комнате, и всего на три знака
              длиннее прежнего: шапка остаётся в один ряд и на 375, и на 390
              (см. замер у кнопки ссылки выше). От md — «Ты на доске «Пати»»:
              длинное «Твой ник виден на доске» замерено — сносило ряд кнопок
              под заголовок, и колода начиналась на 56 px ниже. Полная фраза про
              ник — скринридеру на любой ширине.
            */
            <span className="rounded-(--radius-control) bg-ember/15 text-ember-text px-4 py-3 text-sm font-extrabold">
              <span className="md:hidden">Ты на доске</span>
              <span className="hidden md:inline">Ты на доске «Пати»</span>
              <span className="sr-only"> — твой ник виден всем на странице «Пати»</span>
            </span>
          ) : null}
        </div>
      </div>

      {/*
        Отказ ✕, «Пустить обратно» и доски хосту по ссылке. Живая область
        стоит всегда, меняется только содержимое (components/StatusLine): иначе
        отказ ✕, нажатого внизу экрана, не слышал бы никто — а глазом строку
        в шапке не видно, пока не прокрутишь. Когда ростер научится говорить
        отказы рядом с собой, строке место там.
      */}
      <div role="status" className={publicDenied ? '-mt-3' : 'sr-only'}>
        {publicDenied && <NeedSteam from={`/room/${roomId}`} why="host" />}
      </div>
      {/* Отказ переключателя шапки. При AloneInvite шапка спрятана, и ту же
          строку пишет он сам, под своей плиткой, — здесь она тогда пустая */}
      <StatusLine
        text={aloneInvite ? null : publicMissText}
        className="-mt-3 text-sm text-danger"
      />

      {/*
        Состав над колодой — на телефоне в один ряд, листается вбок, как
        ScrollRail. Он переносился: двух обычных ников («Демо-игрок (ты) · 0
        голосов» и «Демо-друг · 0 голосов») хватало на 350 px колонки, а
        пати из трёх переносилась всегда. Карта (.room-page .deck-stack)
        сдвигалась на ряд ниже, а её высота считается от одного ряда —
        замер на 390×844: кнопки голоса 743–803 под панелью от 794. От md
        переносится, как раньше: там бюджет карты другой.
      */}
      {card && (
        <div className="flex gap-2 md:flex-wrap max-md:-mx-5 max-md:px-5 max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
          {state.members.map((m) => (
            <span
              key={m.id}
              className={`pill shrink-0 whitespace-nowrap cursor-default text-xs ${m.me ? 'is-on' : 'text-dim'}`}
            >
              {/* Одной строкой в одном span: .pill — inline-flex с gap, и
                  голые куски текста вокруг числа становились отдельными
                  флекс-элементами, получая gap поверх пробела: «·  0  голосов» */}
              <span>
                {m.name}
                {m.me ? ' (ты)' : ''} · <span className="tabular-nums">{m.votes}</span>{' '}
                {/* было прибито строкой: «1 голосов», «2 голосов» */}
                {plural(m.votes, 'голос', 'голоса', 'голосов')}
              </span>
            </span>
          ))}
          {/* Распорка: Chrome срезает padding-right у последнего элемента
              в flex+overflow (см. ScrollRail) */}
          <span aria-hidden className="shrink-0 w-px md:hidden" />
        </div>
      )}

      {/*
        «Пустить обратно», пока RoomWaiting нет на экране (см. kickShown).
        kick-undo — для высоты карты на телефоне: строка над колодой сдвигает
        её вниз, и карта короче ровно на это (globals.css, .deck-stack)
      */}
      {!waitingShown && kickUndo && <div className="kick-undo -mt-3">{kickUndo}</div>}

      {deckFailed ? (
        <div className="panel-lift p-8 text-center flex flex-col gap-4 anim-rise">
          <p className="font-semibold">
            {deckLimited ? 'Слишком часто' : 'Не получилось загрузить игры'}
          </p>
          <p className="text-dim text-sm">
            {deckLimited
              ? 'Колоду запрашивали много раз подряд, и на это стоит потолок. Подожди минуту и попробуй снова.'
              : 'Скорее всего, это на нашей стороне.'}
          </p>
          <button
            onClick={() => {
              // Ключ — того, за чем идём, если запрос уходит отсюда: иначе после
              // повтора эффект догружал бы тот же состав вторым запросом
              if (!deckInFlight.current) deckKey.current = deckWant
              void loadDeck()
            }}
            className="btn-ember px-6 py-3 self-center"
          >
            Попробовать ещё раз
          </button>
        </div>
      ) : cards === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : card ? (
        <SwipeDeck
          cards={cards}
          onVote={vote}
          votedCount={votedCount}
          deckTotal={deckTotal}
          alone={state.members.length < 2}
          nowSec={nowSec}
        />
      ) : (
        <RoomWaiting
          roomId={roomId}
          isHost={state.isHost}
          isPublic={state.room.isPublic}
          members={state.members}
          deckSize={state.room.deckSize}
          deckTotal={deckTotal}
          near={likes.near}
          myLikes={likes.mine}
          leader={likes.leader}
          takingLeader={takingLeader}
          leaderMiss={leaderMiss}
          onTakeLeader={() => void takeLeader()}
          onRemoveMember={(memberId) => void removeMember(memberId)}
          onLeave={() => void removeMember()}
          kickUndo={kickUndo}
          leaving={leaving}
          leaveMiss={leaveMissText}
          missedMember={leaveMiss?.memberId ?? null}
          publicBusy={publicBusy}
          publicMiss={publicMissText}
          hasMore={hasMore}
          pulling={pulling}
          pullFailed={pullFailed}
          onPullMore={pullMore}
          share={share}
          // именно localVotes: колода исчезла из-под пальцев прямо сейчас,
          // а не «когда-то в прошлый заход» — только тогда фокус стоит забирать
          cameFromDeck={localVotes > 0}
          onTogglePublic={togglePublic}
        />
      )}
      {/*
        Отказ голоса — под колодой, но не внутри её ветки. Последняя карта
        уходит свайпом сразу, и на её месте встаёт экран ожидания; отказ
        возвращает её, и ветка колоды монтируется заново — строка внутри неё
        рождалась бы вместе с текстом и звучала бы не везде. Здесь она живёт
        всё лобби. Колода своей живой областью заново назовёт вернувшуюся
        карту — эта строка говорит, почему она вернулась.
      */}
      <StatusLine
        text={card && voteFailed ? 'Голос не ушёл — карточка вернулась, свайпни ещё раз.' : null}
        className="mt-3 text-center text-sm text-danger"
      />
    </div>
    </>
  )
}
