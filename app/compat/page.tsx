import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Ambient } from '@/components/Ambient'
import { currentSteamId } from '@/lib/server'
import { CopyCompatLink } from './CopyCompatLink'

export const metadata = {
  title: 'Совместимость',
  description: 'Процент совпадения игровых вкусов по реальным библиотекам и часам — и во что вам зайти вместе.',
}

export const dynamic = 'force-dynamic'

export default async function CompatHubPage() {
  const steamid = await currentSteamId()
  if (!steamid) redirect('/')

  return (
    <div className="relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
      <Ambient />
      <div className="relative max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col gap-4 anim-rise">
        <h1 className="font-display text-display-sm">Проверка совместимости</h1>
        <p className="text-dim text-sm leading-relaxed">
          Кинь эту ссылку любому — сервис сравнит ваши библиотеки и наигранное время по-настоящему,
          а не по анкете: % совпадения вкусов, общие игры и во что вам зайти вместе.
        </p>
        <CopyCompatLink steamid={steamid} />
        <Link href="/quiz" className="text-sm text-dim hover:text-ink transition-colors">
          ← К подбору игры
        </Link>
      </div>
    </div>
  )
}
