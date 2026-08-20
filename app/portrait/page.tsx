import { redirect } from 'next/navigation'
import { bounceTo } from '@/lib/destination'
import { currentSteamId } from '@/lib/server'

export const dynamic = 'force-dynamic'

export default async function MyPortraitPage() {
  const steamid = await currentSteamId()
  redirect(steamid ? `/portrait/${steamid}` : bounceTo('/portrait'))
}
