import { redirect } from 'next/navigation'
import { bounceTo } from '@/lib/destination'
import { lp, toLocale } from '@/lib/i18n'
import { currentSteamId } from '@/lib/server'

export const dynamic = 'force-dynamic'

export default async function MyPortraitPage(props: PageProps<'/[lang]/portrait'>) {
  const [steamid, { lang }] = await Promise.all([currentSteamId(), props.params])
  // На языке страницы: с /en/portrait — на /en/portrait/<id> или английский лендинг
  redirect(lp(toLocale(lang), steamid ? `/portrait/${steamid}` : bounceTo('/portrait')))
}
