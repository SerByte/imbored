import Link from 'next/link'
import { Ambient } from '@/components/Ambient'
import { currentSteamId } from '@/lib/server'
import { CopyCompatLink } from './CopyCompatLink'
import { OpenCompatLink } from './OpenCompatLink'

export const metadata = {
  title: 'Совместимость',
  description:
    'Процент совпадения игровых вкусов по реальным библиотекам и часам — и во что вам зайти вместе.',
}

export const dynamic = 'force-dynamic'

/**
 * Хаб «Совместимость».
 *
 * Раньше первой строкой стоял redirect('/') для всех, у кого нет сессии, — и
 * это был самый дорогой из здешних тупиков. «Совместимость» висит в шапке на
 * КАЖДОЙ странице, включая пять тысяч карточек игр, то есть гость, пришедший
 * из поиска, мог нажать её откуда угодно и получить лендинг без единого слова
 * о том, что произошло и почему.
 *
 * Показываем всем. Гость видит, что это за штука, и три двери; владелец
 * сессии — свою ссылку. Поле «вставь чужую» общее: оно осмысленно и до входа,
 * потому что чужую совместимость смотреть можно только вместе со своей — но
 * узнать, куда ты попал, человек должен раньше, чем его попросят подключиться.
 *
 * Экран страницы результата (/compat/[steamid]) с гостем уже обращается
 * правильно — invite-hero и те же три двери. Не работал ровно хаб.
 */
export default async function CompatHubPage() {
  const steamid = await currentSteamId()

  return (
    <div className="relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
      <Ambient />
      <div className="relative max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col gap-4 anim-rise">
        <h1 className="text-2xl font-bold tracking-tight">Проверка совместимости</h1>
        <p className="text-dim text-sm leading-relaxed">
          Сервис сравнивает библиотеки и наигранное время по-настоящему, а не по анкете: %
          совпадения вкусов, общие игры и во что вам зайти вместе.
        </p>

        {steamid ? (
          <>
            <p className="text-dim text-sm leading-relaxed">Кинь свою ссылку любому — и сравнитесь.</p>
            <CopyCompatLink steamid={steamid} />
          </>
        ) : (
          <>
            <p className="text-dim text-sm leading-relaxed">
              Чтобы получить свою ссылку, нужна библиотека. Прочитаем только список игр и часы.
            </p>
            {/*
              Те же три двери, что на лендинге и на странице приглашения, и в
              том же порядке. next возвращает сюда: человек шёл за своей
              ссылкой, а не за анкетой.
            */}
            <Link
              href="/api/auth/steam?next=%2Fcompat"
              className="rounded-[14px] bg-ember text-on-ember font-semibold py-3 hover:brightness-110 transition"
            >
              Войти через Steam
            </Link>
            <Link
              href="/?next=%2Fcompat"
              className="glass glass-hover rounded-[14px] py-3 text-sm transition"
            >
              Вставить ссылку на профиль
            </Link>
          </>
        )}

        <div className="h-px bg-edge" />
        <OpenCompatLink />

        <Link href="/quiz" className="text-sm text-dim hover:text-ink transition-colors">
          ← К подбору игры
        </Link>
      </div>
    </div>
  )
}
