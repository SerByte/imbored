import type { ReactNode } from 'react'
import type { Locale } from '@/lib/i18n'

/**
 * Текст политики конфиденциальности на обоих языках — то, что читает человек
 * на /privacy и /en/privacy. Вёрстка, Ledger и Section — в page.tsx, здесь
 * только слова (docs/i18n.md, «Как переводить строку», п. 2).
 *
 * Отдельным модулем, а не парами tr() по странице: это юридический текст, и
 * английский обязан идти раздел в раздел и абзац в абзац с русским. Рядом,
 * двумя объектами одной формы, расхождение видно глазом, а пропавший абзац
 * ловит lib/policy.test.ts. Модуль серверный: в клиентский бандл не едет ни
 * один из языков.
 *
 * Названия кнопок в прозе — те же, что на экранах (глоссарий docs/i18n.md):
 * человек ищет на странице ровно то слово, которое прочёл здесь.
 */

export type PolicySection = {
  /** Номер в полях — указатель, по нему раздел называют вслух («пункт 6») */
  n: string
  title: string
  /** Ответ первой строкой — основным цветом */
  answer: ReactNode
  /** Механика — вторичным цветом, тем же кеглем */
  body?: ReactNode
}

export type PolicyCopy = {
  meta: { title: string; description: string }
  /**
   * Дата последней правки СУЩЕСТВА политики — не оформления.
   *
   * Политика без даты не даёт проверить, к какой версии сервиса она
   * относится: человек читает текст и не знает, писан он вчера или год
   * назад. Число зафиксировано вручную намеренно — рендер-тайм подставил бы
   * «сегодня» на каждый заход и обещал бы обновление, которого не было.
   *
   * Своя у каждого языка: правка перевода — правка английского текста, и
   * дату меняет только он. Правка русского существа — правка обоих.
   * Менять вместе с текстом: за этим следит lib/policy.test.ts, он снимает
   * отпечаток с прозы каждого языка и роняет прогон, если проза разошлась с
   * записанным отпечатком.
   */
  updated: string
  /** Начало строки с датой: дата встаёт сразу за ним */
  updatedLead: string
  eyebrow: string
  h1: string
  lead: string
  /** Заголовок списка «читаем / не читаем» для скринридера */
  ledgerTitle: string
  readsTitle: string
  /** Сверено с lib/steam.ts: это всё, что уходит из аккаунта в сервис. */
  reads: string[]
  skipsTitle: string
  /** Обратная сторона того же списка — то, за чем сервис не ходит никогда. */
  skips: string[]
  sections: PolicySection[]
  home: string
}

const MAIL = (
  <a href="mailto:hello@imbored.cc" className="tap text-ember-text hover:underline">
    hello@imbored.cc
  </a>
)

const RU: PolicyCopy = {
  meta: {
    title: 'Конфиденциальность',
    description: 'Какие данные собирает imbored, где они хранятся и как их удалить.',
  },
  updated: '18 октября 2026',
  updatedLead: 'Обновлено ',
  eyebrow: 'Конфиденциальность',
  h1: 'Что мы о тебе знаем',
  lead: 'imbored читает список твоих игр, чтобы подобрать следующую. Больше для этого ничего не нужно — больше ничего и не берётся. Данные не продаются и не уходят рекламодателям.',
  ledgerTitle: 'Что сервис читает и чего не читает',
  readsTitle: 'Читаем',
  reads: [
    'SteamID, имя профиля и аватар',
    'Список игр и наигранные часы',
    'Активность за последние две недели',
    'Список желаемого, если он открыт',
    'Ответы опроса, оценки и скрытые игры',
  ],
  skipsTitle: 'Не читаем',
  skips: ['Пароль от Steam', 'Друзей и переписку', 'Платежи и покупки', 'Что ты делаешь вне imbored'],
  sections: [
    {
      n: '01',
      title: 'Какие данные собираются',
      answer:
        'Всё, что нужно для подбора, и ничего сверх: профиль Steam, библиотека и твои же ответы внутри сервиса.',
      body: (
        <>
          <p>
            Когда ты подключаешь профиль Steam, сервис запрашивает у Steam Web API и сохраняет:
            твой SteamID64, отображаемое имя и аватар, список игр библиотеки с наигранным
            временем, а также активность за последние две недели.
          </p>
          <p>
            Дополнительно сохраняются твои действия внутри сервиса: ответы мини-опроса о
            настроении, оценки «зашло» и «не то» с причиной, свайпы «Интересно» и «Мимо» в
            колоде «Полистать», список скрытых игр и участие в комнатах для совместной игры.
            Оценки «зашло», скрытые игры и приглянувшееся ты видишь сам — в библиотеке и в
            «Полистать» — и там же можешь их убрать.
          </p>
          <p>
            Если ты вошёл через Steam и список желаемого открыт в его настройках, сервис читает и
            его — чтобы показать в библиотеке, что из этого списка сейчас продаётся со скидкой.
            Хранятся только номера игр, без дат добавления; при следующем чтении список
            заменяется новым.
          </p>
          <p>
            Когда ты, войдя через Steam, открываешь чужую ссылку на сравнение, сервис запоминает,
            с кем ты сравнился и какой вышел процент.
          </p>
          <p>
            Если ты вошёл через Steam и выпустил на странице «Что нового» ссылку на RSS, сервис
            хранит её отпечаток и дату выпуска. Саму ссылку он показывает один раз и не хранит.
            По ней открывается лента крупных патчей игр из твоей библиотеки — заголовок, дата и
            пересказ, без имени профиля и SteamID. Её видит ридер или бот, которому ты её отдал,
            и любой, кто её узнает: по ней понятно, какие игры у тебя есть, поэтому не
            публикуй её. Там же ссылку можно выпустить заново или отключить — старая
            перестаёт работать сразу.
          </p>
          <p>
            Когда ты нажимаешь «Отправить другу» у игры из подборки или игры дня, сервис
            сохраняет этот выбор: игру, объяснение, почему она, и дату. Пока не нажал —
            не сохраняется ничего.
          </p>
          <p>
            К оценке прикладывается снимок выдачи: где стояла карточка, каким способом
            собрана подборка и из каких частей сложилась её оценка. Он нужен только затем,
            чтобы проверять, какие решения в подборе работают, — на экране он не
            показывается.
          </p>
          <p>
            Когда ты запускаешь игру из подборки или идёшь за ней в магазин, сервис
            запоминает это и по следующим снимкам библиотеки смотрит, сколько ты в неё
            сыграл за две недели и появилась ли она у тебя. Если ты не заходил дольше, это
            сверяется один раз — по первому снимку после возвращения. Если сыграно
            заметно, раз в сутки может спросить, как тебе игра, а на главной, пока ответа
            нет, напомнит о ней одной строкой, — ответ сохраняется вместе с этой записью.
            Эти записи видишь и ты сам — в библиотеке, в разделе «Твои вечера»: там же
            ответ можно поменять.
          </p>
          <p>
            Когда ты ставишь игру из подборки на загрузку или нажимаешь «Сыграю вечером на
            ПК», сервис запоминает это вместе с оценками — как план, а не оценку: на подбор
            он не влияет. Полтора дня, пока ты её не запустил и не передумал, игра ждёт
            одной строкой на главной и в подборке.
          </p>
          <p>
            Пароль от Steam сервис не видит <span className="text-ink">никогда</span>: вход
            идёт через официальный Steam OpenID, логин и пароль вводятся на сайте Valve.
          </p>
        </>
      ),
    },
    {
      n: '02',
      title: 'Зачем это нужно',
      answer: 'Библиотека и часы — единственный способ понять твой вкус.',
      body: (
        <p>
          Без них подбор превращается в список популярного, который ты и так видел. Оценки
          нужны, чтобы он становился точнее. Снимки библиотеки хранятся, чтобы показывать
          динамику бэклога и итоги.
        </p>
      ),
    },
    {
      n: '03',
      title: 'Где хранятся данные',
      answer: 'В Ирландии — и база, и серверные функции.',
      body: (
        <>
          <p>
            Данные лежат в базе Turso (облачный SQLite) в дата-центре на территории{' '}
            <span className="text-ink">Ирландии</span>. Приложение работает на инфраструктуре
            Vercel: серверные функции выполняются в{' '}
            <span className="text-ink">Ирландии</span>, статические файлы раздаются через
            глобальную CDN, узлы которой расположены в том числе за пределами Европейского союза.
          </p>
          <p>Сессия хранится в подписанной cookie — только твой SteamID, без личных данных.</p>
        </>
      ),
    },
    {
      n: '04',
      title: 'Кому передаются данные',
      answer: 'Наружу уходят названия игр, а не ты. Рекламным сетям не уходит ничего.',
      body: (
        <>
          <p>
            Сервис обращается к внешним источникам, но <span className="text-ink">не отправляет
            им твои персональные данные</span>: Steam Web API и Steam Store (метаданные, теги
            и отзывы об играх).
          </p>
          <p>
            Если включены умные объяснения, в Claude API (Anthropic) отправляются названия игр
            из твоей библиотеки с количеством часов и ответы опроса — чтобы сгенерировать текст
            рекомендации. Для текста портрета игрока туда же уходит имя профиля Steam. SteamID
            и аватар не передаются.
          </p>
          <p>
            Данные не продаются, не передаются рекламным сетям и не используются для профилирования
            за пределами подбора игр.
          </p>
        </>
      ),
    },
    {
      n: '05',
      title: 'Портрет игрока и ссылки на него',
      answer: 'Портрет публичный: его видит любой, у кого есть ссылка.',
      body: (
        <>
          <p>
            По той же ссылке открываются итоги года: сколько наиграно по снимкам библиотеки,
            какие игры впервые запущены и какие появились в библиотеке. Рядом стоят даты
            снимков, по которым это посчитано, — по ним видно, когда ты примерно заходил в
            сервис. Появились — не значит куплены: покупок сервис не видит.
          </p>
          <p>
            Когда такую ссылку отправляют в мессенджер или соцсеть, площадка сама запрашивает
            превью — картинку с именем профиля, обложками игр и числами из портрета. Ссылка на
            сравнение разворачивается так же: имя профиля, обложки игр из библиотеки, число игр и
            часов. Процента на ней нет — его видит тот, кто откроет ссылку.
          </p>
          <p>
            Владелец ссылки на сравнение видит у себя, кто её открыл после входа через Steam: имя
            профиля, процент и когда это было, — и может открыть ваше сравнение в ответ. Вход по
            ссылке на профиль и демо таких отметок не оставляют.
          </p>
          <p>
            Ссылка на выбор, которую ты отправил другу, тоже открыта всем, у кого она есть: на
            странице и в превью — игра, объяснение и дата. Объяснение то же, что ты видел в
            подборке: в нём могут быть названия других твоих игр и часы в них. Цены из него
            убираются. Имени профиля и SteamID там нет, а сам адрес — случайная строка, по
            которой тебя не найти.
          </p>
          <p>
            Эти превью кэшируются на стороне площадок, и отозвать их оттуда сервис не может. Если
            не хочешь, чтобы портрет расходился, — просто не публикуй ссылку.
          </p>
        </>
      ),
    },
    {
      n: '06',
      title: 'Сколько это хранится и как удалить',
      answer: 'Пока пользуешься. Удалить всё можно кнопкой в библиотеке — сразу, или письмом — за 30 дней.',
      body: (
        <>
          <p>
            Из снимков библиотеки хранятся три последних — старые удаляются автоматически.
            Кроме них при первом за год заходе остаётся одна отметка библиотеки: без неё не
            посчитать, сколько ты наиграл за год, потому что Steam отдаёт только часы за всё
            время. Список желаемого хранится один — последний прочитанный.
          </p>
          <p>
            Профиль и портрет, оценки и скрытые игры хранятся, пока ты пользуешься сервисом.
            Снимок выдачи у оценки стирается через 90 дней — сама оценка при этом остаётся,
            а отметка «поставил на загрузку» или «сыграю вечером» уходит целиком.
            Записи о том, сколько ты сыграл после совета, удаляются через те же 90 дней, как и
            отметки о сравнениях — а по запросу они уходят у обеих сторон. Ссылки на выбор
            живут 30 дней, потом страница по ним пропадает.
            Комнаты для совместной игры живут две недели после создания и затем удаляются
            вместе с участниками и голосами. Записи о входах — через месяц после того, как
            истёк сам вход. Отпечаток ссылки на RSS живёт, пока ты её не отключишь или не
            выпустишь новую; его стирает и выход на всех устройствах.
          </p>
          <p>
            Чтобы сервис нельзя было завалить запросами или перебором, на части действий — вход,
            разбор библиотеки, подбор, игра дня, колода «Полистать», оценки, портрет, комнаты,
            ссылки на выбор, тексты патчей, отчёты об ошибках, удаление данных — мы считаем
            обращения с одного IP-адреса.
            Такой счётчик хранит только адрес и число и стирается не позже чем через двое суток.
            Кроме того, есть личные потолки — они считаются не по адресу, а по твоему SteamID:
            подбор, игра дня, «Полистать», разбор библиотеки, оценки, ответы «как тебе?», ссылки
            на выбор, голоса, колода и остальные действия в пати, выпуск ссылки на RSS и то,
            сколько раз ридер забирал ленту. Пересборка текста портрета считается по SteamID
            того, чей он, — кто бы его ни открыл. При входе по ссылке на профиль к SteamID
            добавляется номер этой сессии, чтобы чужой с той же ссылкой не тратил твой потолок.
            Такой счётчик хранит только SteamID, номер сессии, если он есть, и число. Он живёт
            до конца своего окна — от минуты до часа (у демо-профиля счётчик подборов с умными
            объяснениями — не дольше суток) — и стирается ближайшей уборкой после него.
          </p>
          <p>
            Чтобы удалить всё: войди через Steam и нажми «Удалить всё обо мне» внизу
            библиотеки — перед удалением сервис покажет, что именно о тебе хранится, и
            удалит сразу. Или напиши на почту ниже, указав ссылку на свой профиль Steam.
            Удаляется всё перечисленное, включая годовые отметки, а комнаты, где ты сейчас
            хост, — целиком. Хост, ушедший из комнаты, передаёт её тем, кто остался, а
            из остальных комнат уходят твоё участие и голоса. Отдельно можно в любой момент
            закрыть доступ к библиотеке в настройках приватности Steam — тогда сервис перестанет
            её видеть.
          </p>
          <p>
            Вместе с удалением ты выходишь на всех устройствах. Для этого остаётся одна
            отметка — SteamID и время удаления, больше ничего: вход живёт в cookie до года, и
            без отметки cookie на другом устройстве продолжала бы тебя впускать. Отметка
            стирается сама через год и месяц — к этому времени истекает любой вход, сделанный
            до удаления.
          </p>
        </>
      ),
    },
    {
      n: '07',
      title: 'Cookies и аналитика',
      answer: 'Только технические cookie. Рекламных трекеров нет.',
      body: (
        <>
          <p>
            В cookie лежит подписанный SteamID — она нужна, чтобы сервис узнавал тебя между
            страницами.
          </p>
          <p>
            Пока идёт вход через Steam, на десять минут появляется вторая: в ней случайная строка,
            которая связывает возврат из Steam с тем браузером, где вход начали. Она стирается
            сразу после возврата.
          </p>
          {/* «Не предлагать» (lib/mutetags.ts): кука, а не запись в базе.
              path=/ — браузер шлёт её всюду, а читают подбор, игра дня и
              «Полистать» (currentMutes в lib/server). Сам фильтр в базу не
              пишется: игра дня под ним ложится рядом с общей под ключом без
              наборов (mutedDayKey в lib/daily) и уходит с уборкой дня
              (sweepDailyPicks). Гасят куку выход и «Удалить всё обо мне» —
              одним помощником (clearDeviceCookies в lib/server). Названа
              кнопка, а не «удаление данных»: удаление по письму идёт
              скриптом на сервере (scripts/forget-user.ts), и куку в
              браузере человека ему не погасить */}
          <p>
            Если на экране настроения выбрать, чего не предлагать, выбор ляжет в третью cookie —
            короткие ключи наборов вроде horror или vr, без SteamID. Браузер отправляет её с
            каждым запросом к сайту, а читают её только подбор, игра дня и «Полистать»: сервер
            отсеивает по ней игры, а сам фильтр не хранит. Остаётся лишь игра дня, выбранная с
            его учётом, — на пару суток, как и обычная. Cookie живёт год с последнего захода на
            экран настроения, а выход и кнопка «Удалить всё обо мне» её стирают.
          </p>
          {/* Кука lang (LANG_COOKIE в lib/i18n.ts): пишут переключатель
              «RU / EN» в подвале (components/LocaleSwitch) и вход с
              английской версии (app/api/auth/steam/return,
              components/landing/ConnectCard), читают правило «/» в
              next.config и matcher прокси (lib/homelocale.ts).
              clearDeviceCookies её не гасит: она про браузер, а не про
              человека, — как тема */}
          <p>
            Четвёртая cookie — язык сайта, только «ru» или «en». Она появляется, если переключить
            язык внизу страницы или войти с английской версии, и нужна, чтобы главная открывалась
            на твоём языке. Живёт год. О тебе в ней ничего нет, поэтому выход и «Удалить всё обо
            мне» её не трогают — язык остаётся тем, что ты выбрал.
          </p>
          <p>
            Несколько мелочей сайт помнит прямо в браузере. Например, последнюю подборку —
            пятнадцать минут и только в этой вкладке, чтобы после «Назад» не подбирать заново.
            Она никуда не отправляется, а выход её стирает.
          </p>
          <p>
            Для подсчёта посещаемости подключена Vercel Web Analytics: она собирает обезличенную
            статистику (открытая страница, тип устройства, страна) <span className="text-ink">без
            cookies</span> и не отслеживает тебя на других сайтах.
          </p>
          <p>
            Если страница у тебя сломалась, браузер отправит нам короткий отчёт об ошибке: её
            текст, раздел сайта и название браузера. SteamID, коды комнат, адрес страницы
            целиком и cookie в отчёт не попадают — они вырезаются ещё в браузере и ещё раз на
            сервере. Так же, без личных данных, записываются сбои на сервере. Сами отчёты
            остаются в журналах хостинга Vercel и ни с кем не делятся, а в нашей базе от них
            остаётся только число: сколько сбоев какого вида случилось за час.
          </p>
          <p>
            Ещё мы считаем несколько шагов: вход, ответы на вопросы, показ игры, нажатия
            «Запустить», «Поделиться» — вместе с тем, чем поделились: пати или её матчем,
            сравнением, портретом, итогами года, выбором или патчем, — и «Скачать карточку»,
            открытие приглашения в пати, показ строки о демо-режиме и нажатия в ней, раскрытие
            подсказки «Где взять?» у поля ссылки на профиль.
            Считается только число за час — <span className="text-ink">без SteamID</span>, без
            адреса страницы и без всего, что связало бы шаги между собой или с тобой.
          </p>
          <p>
            К профилю привязан ещё день твоего последнего захода — одна дата, без времени и без
            истории: следующий заход её просто перезаписывает. По ней считается, сколько
            пришедших за неделю возвращается назавтра, через неделю и через месяц, — только
            общим числом на всю неделю прихода, без SteamID и без дня захода. Дата удаляется
            вместе с профилем.
          </p>
          <p>
            У общих ссылок — на сравнение, портрет, пати и её матч, выбор, патч — и у ссылок из
            наших постов на DTF, Пикабу, Хабре, vc.ru и в Telegram в адресе есть метка ref. Если ты
            пришёл по такой ссылке, вкладка запомнит, откуда, пока открыта, и шаги посчитаются
            с этой меткой: так видно, какие ссылки вообще приводят людей. Эти числа хранятся 90
            дней.
          </p>
        </>
      ),
    },
    {
      n: '08',
      title: 'Связь',
      answer: <>Вопросы и запросы на удаление данных —{' '}{MAIL}</>,
      body: (
        <p className="text-sm text-faint">
          imbored — независимый проект, не связанный с Valve Corporation. Steam и логотип Steam —
          товарные знаки Valve Corporation.
        </p>
      ),
    },
  ],
  home: 'На главную',
}

/*
 * Английский — раздел в раздел и абзац в абзац с русским: тот же порядок, те
 * же числа и сроки, те же оговорки. Названия кнопок в кавычках — подписи
 * английских экранов (глоссарий docs/i18n.md), имена шагов Steam — из
 * английского клиента Steam. Комментарии про куки «Не предлагать» и lang —
 * у русских абзацев выше: механика одна на оба языка.
 */
const EN: PolicyCopy = {
  meta: {
    title: 'Privacy',
    description: 'What data imbored collects, where it’s stored and how to delete it.',
  },
  updated: 'October 19, 2026',
  updatedLead: 'Updated ',
  eyebrow: 'Privacy',
  h1: 'What we know about you',
  lead: 'imbored reads your list of games to pick your next one. It needs nothing else for that — so it takes nothing else. Your data isn’t sold and never goes to advertisers.',
  ledgerTitle: 'What we read and what we don’t',
  readsTitle: 'We read',
  reads: [
    'SteamID, profile name and avatar',
    'Your game list and hours played',
    'Activity over the last two weeks',
    'Your wishlist, if it’s public',
    'Quiz answers, ratings and hidden games',
  ],
  skipsTitle: 'We don’t read',
  skips: ['Your Steam password', 'Your friends and messages', 'Payments and purchases', 'What you do outside imbored'],
  sections: [
    {
      n: '01',
      title: 'What data we collect',
      answer:
        'Everything the picks need and nothing more: your Steam profile, your library and your own answers inside the service.',
      body: (
        <>
          <p>
            When you connect your Steam profile, the service requests from the Steam Web API and
            stores: your SteamID64, display name and avatar, the list of games in your library with
            playtime, and your activity over the last two weeks.
          </p>
          <p>
            We also store what you do inside the service: your answers to the short mood quiz,
            “Liked it” and “Not it” ratings with a reason, “Into it” and “Skip” swipes in the
            “Browse” deck, your list of hidden games, and your participation in rooms for playing together.
            You can see your “Liked it” ratings, hidden games and what caught your eye yourself — in
            your library and in “Browse” — and remove them there too.
          </p>
          <p>
            If you signed in with Steam and your wishlist is public in your Steam settings, the
            service reads it too — to show in your library which games on it are on sale right now.
            Only game IDs are stored, without the dates you added them; the next read replaces the list
            with a fresh one.
          </p>
          <p>
            When you’re signed in with Steam and open someone else’s compatibility link, the service
            remembers who you compared with and what percentage you got.
          </p>
          <p>
            If you signed in with Steam and got an RSS link on the “What’s new” page, the service
            stores its fingerprint and the date it was issued. The link itself is shown once and
            never stored. It opens a feed of major patches for games in your library — title, date
            and summary, with no profile name or SteamID. It’s visible to the reader or bot you gave
            it to, and to anyone else who gets hold of it: it reveals which games you own, so don’t
            publish it. On the same page you can issue a new link or turn it off — the old one stops working
            immediately.
          </p>
          <p>
            When you press “Send to a friend” on a game from your picks or on the game of the day,
            the service saves that pick: the game, the explanation of why it’s the one, and the
            date. Until you press it, nothing is saved.
          </p>
          <p>
            Each rating comes with a snapshot of the picks: where the card was, how the picks were
            put together and what the card’s score was made of. It’s only used to check which
            decisions in the picking actually work — it’s never shown on screen.
          </p>
          <p>
            When you launch a game from your picks or go to the store for it, the service remembers
            that and uses your next library snapshots to see how much you played it over two weeks
            and whether it showed up in your library. If you were away longer, this is checked once
            — against the first snapshot after you’re back. If you played a fair amount, it may ask
            once a day how you like the game, and until you answer, the home page reminds you of it
            in one line — your answer is saved with that record. You can see these records yourself
            — in your library, under “Your evenings” — and change your answer there.
          </p>
          <p>
            When you start the download for a game from your picks or press “Play tonight on PC”,
            the service saves that alongside your ratings — as a plan, not a rating: it doesn’t
            affect the picks. For a day and a half, until you launch it or change your mind, the
            game waits as one line on the home page and in your picks.
          </p>
          <p>
            The service <span className="text-ink">never</span> sees your Steam password: sign-in
            goes through the official Steam OpenID, and your login and password are entered on
            Valve’s site.
          </p>
        </>
      ),
    },
    {
      n: '02',
      title: 'Why we need it',
      answer: 'Your library and hours are the only way to understand your taste.',
      body: (
        <p>
          Without them, the picks turn into a list of popular games you’ve already seen. Ratings
          make the picks more accurate. Library snapshots are kept to show how your backlog changes
          over time and to build your year in review.
        </p>
      ),
    },
    {
      n: '03',
      title: 'Where the data is stored',
      answer: 'In Ireland — both the database and the server functions.',
      body: (
        <>
          <p>
            The data lives in a Turso database (cloud SQLite) in a data center in{' '}
            <span className="text-ink">Ireland</span>. The app runs on Vercel’s infrastructure:
            server functions run in <span className="text-ink">Ireland</span>, and static files are
            served through a global CDN with nodes located, among other places, outside the
            European Union.
          </p>
          <p>Your session is kept in a signed cookie — just your SteamID, no personal data.</p>
        </>
      ),
    },
    {
      n: '04',
      title: 'Who we share data with',
      answer: 'What goes out is game names, not you. Nothing goes to ad networks.',
      body: (
        <>
          <p>
            The service talks to outside sources but{' '}
            <span className="text-ink">doesn’t send them your personal data</span>: the Steam Web
            API and the Steam Store (game metadata, tags and reviews).
          </p>
          <p>
            When smart explanations are on, the names of games in your library with your hours and
            your quiz answers are sent to the Claude API (Anthropic) to write the recommendation
            text. For the player portrait text, your Steam profile name goes there too. Your SteamID
            and avatar are not shared.
          </p>
          <p>
            The data isn’t sold, isn’t shared with ad networks and isn’t used for profiling beyond
            picking games.
          </p>
        </>
      ),
    },
    {
      n: '05',
      title: 'Player portrait and links to it',
      answer: 'The portrait is public: anyone with the link can see it.',
      body: (
        <>
          <p>
            The same link opens your year in review: how much you played according to your library
            snapshots, which games you launched for the first time and which ones were added to your
            library. Next to it are the dates of the snapshots it was counted from — they show
            roughly when you visited the service. “Added” doesn’t mean bought: the service can’t see
            purchases.
          </p>
          <p>
            When such a link is sent to a messaging app or social network, the platform fetches a
            preview by itself — an image with your profile name, game covers and numbers from the
            portrait. A compatibility link unfurls the same way: profile name, covers of games from
            the library, the number of games and hours. The percentage isn’t on it — only the person
            who opens the link sees it.
          </p>
          <p>
            The owner of a compatibility link sees who opened it after signing in with Steam: the
            profile name, the percentage and when it happened — and can open your comparison in
            return. Visits with a profile link or the demo leave no such marks.
          </p>
          <p>
            A pick link you sent to a friend is also open to anyone who has it: the page and the
            preview show the game, the explanation and the date. The explanation is the same one
            you saw in your picks: it may name other games of yours and your hours in them. Prices
            are removed from it. There’s no profile name or SteamID there, and the address itself is
            a random string that can’t lead anyone to you.
          </p>
          <p>
            These previews are cached by the platforms, and the service can’t take them back from
            there. If you don’t want your portrait to spread, just don’t publish the link.
          </p>
        </>
      ),
    },
    {
      n: '06',
      title: 'How long it’s kept and how to delete it',
      answer:
        'As long as you use the service. You can delete everything instantly with the button in your library, or by email within 30 days.',
      body: (
        <>
          <p>
            We keep the three most recent library snapshots — older ones are deleted
            automatically. Besides those, your first visit of the year leaves one library
            checkpoint: without it we couldn’t count how much you played over the year, because
            Steam only gives total hours for all time. Only one wishlist is kept — the latest one
            read.
          </p>
          <p>
            Your profile and portrait, ratings and hidden games are kept as long as you use the
            service. The picks snapshot attached to a rating is erased after 90 days — the rating
            itself stays, while a “started the download” or “play tonight” mark goes away entirely.
            Records of how much you played after a pick are deleted after the same 90 days, as are
            compatibility checks — and on request they’re removed for both sides. Pick links live
            for 30 days, then their page disappears. Rooms for playing together live for two weeks
            after they’re created and are then deleted along with their members and votes.
            Sign-in records — a month after the sign-in itself expires. The RSS link fingerprint
            lives until you turn the link off or issue a new one; signing out everywhere erases it
            too.
          </p>
          <p>
            To keep the service from being flooded with requests or brute-forced, we count requests
            per IP address for some actions: sign-in, reading your library, picks, the game of the
            day, the “Browse” deck, ratings, the portrait, rooms, pick links, patch summaries, error
            reports, data deletion. Such a counter stores only the address and a
            number and is erased within two days at most. There are also personal limits — counted
            not by address but by your SteamID: picks, the game of the day, “Browse”, reading your
            library, ratings, answers to “How is it?”, pick links, votes, the deck and other party
            actions, issuing an RSS link, and how many times a reader fetched the feed. Rebuilding
            the portrait text is counted against the SteamID of the person it belongs to — no
            matter who opens it. When you sign in with a profile link, the number of that session is
            added to the SteamID, so a stranger with the same link doesn’t use up your limit. Such a
            counter stores only the SteamID, the session number if there is one, and a number. It
            lives until the end of its window — from a minute to an hour (for the demo profile, the
            counter for picks with smart explanations lasts up to a day) — and is erased by the next
            cleanup after that.
          </p>
          <p>
            To delete everything: sign in with Steam and press “Delete everything about me” at the
            bottom of your library — before deleting, the service shows exactly what it stores about
            you, and then deletes it right away. Or email the address below with a link to your
            Steam profile. Everything listed above is deleted, including the yearly checkpoints,
            and rooms where you’re currently the host are deleted entirely. A host who has left a
            room hands it over to those who stayed, and your memberships and votes are removed from
            all other rooms. Separately, you can close access to your library in your Steam privacy
            settings at any time — then the service will no longer see it.
          </p>
          <p>
            Deleting also signs you out on all devices. For that, one marker remains — your SteamID
            and the time of deletion, nothing else: a sign-in lives in a cookie for up to a year, and
            without the marker, a cookie on another device would still let you back in. The marker
            erases itself after a year and a month — by then, any sign-in made before the deletion
            has expired.
          </p>
        </>
      ),
    },
    {
      n: '07',
      title: 'Cookies and analytics',
      answer: 'Only technical cookies. No ad trackers.',
      body: (
        <>
          <p>The cookie holds a signed SteamID — it lets the service recognize you from page to page.</p>
          <p>
            While you’re signing in with Steam, a second one appears for ten minutes: it holds a
            random string that ties the return from Steam to the browser where the sign-in started.
            It’s erased right after you return.
          </p>
          <p>
            If you choose what not to suggest on the mood screen, your choice goes into a third
            cookie — short set keys like horror or vr, without your SteamID. The browser sends it
            with every request to the site, but only the picks, the game of the day and “Browse”
            read it: the server filters games by it and doesn’t store the filter itself. All that
            remains is the game of the day chosen with it in mind — for a couple of days, like a
            regular one. The cookie lives for a year from your last visit to the mood screen, and
            signing out or the “Delete everything about me” button erases it.
          </p>
          <p>
            The fourth cookie is the site language, just “ru” or “en”. It appears if you switch the
            language at the bottom of the page or sign in from the English version, and it makes the
            home page open in your language. It lives for a year. There’s nothing about you in it,
            so signing out and “Delete everything about me” leave it alone — the language stays the
            one you chose.
          </p>
          <p>
            The site remembers a few small things right in your browser. For example, your latest
            picks — for fifteen minutes and only in that tab, so “Back” doesn’t make you pick again.
            They’re never sent anywhere, and signing out erases them.
          </p>
          <p>
            To count visits, we use Vercel Web Analytics: it collects anonymous statistics (the page
            opened, device type, country) <span className="text-ink">without cookies</span> and
            doesn’t track you on other sites.
          </p>
          <p>
            If a page breaks for you, your browser sends us a short error report: the error text,
            the section of the site and the browser name. SteamIDs, room codes, the full page
            address and cookies don’t make it into the report — they’re cut out in the browser and
            once more on the server. Server failures are logged the same way, without personal data.
            The reports themselves stay in Vercel’s hosting logs and aren’t shared with anyone, and
            all that’s left of them in our database is a number: how many failures of each kind
            happened in an hour.
          </p>
          <p>
            We also count a few steps: sign-in, quiz answers, a game being shown, presses of
            “Launch” and “Share” — along with what was shared: a party or its match, a comparison, a
            portrait, a year in review, a pick or a patch — and “Download card”, opening a party
            invite, the demo-mode line being shown and clicks on it, and opening the “Where’s that?”
            hint by the profile link field. Only a number per hour is counted —{' '}
            <span className="text-ink">without your SteamID</span>, without the page address and
            without anything that would link the steps to each other or to you.
          </p>
          <p>
            Your profile also keeps the day of your last visit — a single date, with no time and no
            history: your next visit simply overwrites it. It’s used to count how many of the people
            who arrived in a given week come back the next day, a week later and a month later —
            only as one total for the whole week they arrived, without SteamIDs and without the day
            of the visit. The date is deleted along with your profile.
          </p>
          <p>
            Shared links — to a comparison, a portrait, a party and its match, a pick, a patch — and
            links from our posts on DTF, Pikabu, Habr, vc.ru and Telegram carry a ref tag in the
            address. If you came through such a link, the tab remembers where from while it’s open,
            and the steps are counted with that tag: this shows which links bring people in at all.
            These numbers are kept for 90 days.
          </p>
        </>
      ),
    },
    {
      n: '08',
      title: 'Contact',
      answer: <>Questions and data deletion requests —{' '}{MAIL}</>,
      body: (
        <p className="text-sm text-faint">
          imbored is an independent project not affiliated with Valve Corporation. Steam and the
          Steam logo are trademarks of Valve Corporation.
        </p>
      ),
    },
  ],
  home: 'Back to home',
}

export const COPY = { ru: RU, en: EN } satisfies Record<Locale, PolicyCopy>
