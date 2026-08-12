import Link from 'next/link'
import { Ambient } from '@/components/Ambient'

export const metadata = {
  title: 'Конфиденциальность — imbored',
  description: 'Какие данные собирает imbored, где они хранятся и как их удалить.',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-bold text-lg">{title}</h2>
      <div className="text-dim leading-relaxed flex flex-col gap-2">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto w-full max-w-2xl px-5 pt-28 pb-16 flex flex-col gap-8">
        <div className="flex flex-col gap-2 anim-rise">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            Конфиденциальность
          </h1>
          <p className="text-dim">
            Коротко: imbored хранит ровно столько, сколько нужно, чтобы подобрать тебе игру.
            Ничего не продаёт и не передаёт рекламодателям.
          </p>
        </div>

        <Section title="Какие данные собираются">
          <p>
            Когда ты подключаешь профиль Steam, сервис запрашивает у Steam Web API и сохраняет:
            твой SteamID64, отображаемое имя и аватар, список игр библиотеки с наигранным
            временем, а также активность за последние две недели.
          </p>
          <p>
            Дополнительно сохраняются твои действия внутри сервиса: ответы мини-опроса о
            настроении, оценки «зашло» и «не то» с причиной, список скрытых игр и участие
            в комнатах для совместной игры.
          </p>
          <p>
            Пароль от Steam сервис не видит никогда: вход идёт через официальный Steam OpenID,
            логин и пароль вводятся на сайте Valve.
          </p>
        </Section>

        <Section title="Зачем это нужно">
          <p>
            Библиотека и наигранное время — единственный способ понять твой вкус и предложить
            игру, которая действительно подойдёт. Оценки нужны, чтобы подбор становился точнее.
            Снимки библиотеки хранятся, чтобы показывать динамику бэклога и итоги.
          </p>
        </Section>

        <Section title="Где хранятся данные">
          <p>
            Данные лежат в базе Turso (облачный SQLite) в дата-центре на территории{' '}
            <span className="text-ink">Европейского союза (Германия / Нидерланды)</span>.
            Приложение работает на инфраструктуре Vercel; её серверы и CDN расположены в{' '}
            <span className="text-ink">Европейском союзе и США</span>.
          </p>
          <p>
            Сессия хранится в подписанной cookie — только твой SteamID, без личных данных.
          </p>
        </Section>

        <Section title="Кому передаются данные">
          <p>
            Сервис обращается к внешним источникам, но <span className="text-ink">не отправляет
            им твои персональные данные</span>: Steam Web API и Steam Store (метаданные и отзывы
            об играх), SteamSpy (теги игр).
          </p>
          <p>
            Если включены умные объяснения, в Claude API (Anthropic) отправляются названия игр
            из твоей библиотеки с количеством часов и ответы опроса — чтобы сгенерировать текст
            рекомендации. SteamID, имя и аватар туда не передаются.
          </p>
          <p>
            Данные не продаются, не передаются рекламным сетям и не используются для профилирования
            за пределами подбора игр.
          </p>
        </Section>

        <Section title="Сколько это хранится и как удалить">
          <p>
            Данные хранятся, пока ты пользуешься сервисом. Хранится не больше трёх последних
            снимков библиотеки — старые удаляются автоматически.
          </p>
          <p>
            Чтобы удалить всё: напиши на почту ниже, указав ссылку на свой профиль Steam.
            Данные удаляются полностью в течение 30 дней. Отдельно можно в любой момент закрыть
            доступ к библиотеке в настройках приватности Steam — тогда сервис перестанет её видеть.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            Используется одна техническая cookie с подписанным SteamID — она нужна, чтобы сервис
            узнавал тебя между страницами. Аналитики, счётчиков и рекламных трекеров нет.
          </p>
        </Section>

        <Section title="Связь">
          <p>
            Вопросы и запросы на удаление данных:{' '}
            <a href="mailto:hello@imbored.cc" className="text-ember hover:underline">
              hello@imbored.cc
            </a>
          </p>
          <p className="text-xs text-dim/60">
            imbored — независимый проект, не связанный с Valve Corporation. Steam и логотип Steam —
            товарные знаки Valve Corporation.
          </p>
        </Section>

        <div className="text-center pt-2">
          <Link href="/" className="text-sm text-dim hover:text-ink transition-colors">
            ← На главную
          </Link>
        </div>
      </div>
    </div>
  )
}
