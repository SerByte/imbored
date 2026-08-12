import { redirect } from 'next/navigation'
import { currentSteamId } from '@/lib/server'

export const dynamic = 'force-dynamic'

export default async function MyPortraitPage() {
  const steamid = await currentSteamId()
  redirect(steamid ? `/portrait/${steamid}` : '/')
}
