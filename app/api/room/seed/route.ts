import { NextResponse } from 'next/server'
import { roomSeed } from '@/lib/roomseed'
import { currentSteamId, getDb } from '@/lib/server'

/**
 * Какую игру новая комната возьмёт первой картой: { appid, name } либо 404.
 *
 * Нужен строке «Первой картой — …» на /room/new. Страница клиентская и
 * пререндерится статически (components/useSearch), имени игры из адреса ей
 * взять неоткуда, а без имени хост выбирал бы настроение, не зная, доехала ли
 * игра, в которую он звал. Имя в самом адресе не годится: адрес приходит из
 * чата, и строка обещала бы одну игру, а комната взяла бы другую.
 *
 * Проверка — та же, что у создания комнаты (roomSeed в lib/roomseed): ответ
 * обязан совпадать с тем, что сделает /api/room/create. Поэтому и сессия
 * читается — свой бан хоста убирает игру и там.
 *
 * Кэш — private и no-store: ответ зависит от банов смотрящего, а вход
 * посреди сценария (гостя разворачивает на него) меняет ответ. Лимита частоты
 * нет по той же причине, что у /api/session/owns: строка каталога по ключу и
 * баны по индексу дешевле, чем сама проверка лимита, которая пишет в базу.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('game')
  const [db, steamid] = await Promise.all([getDb(), currentSteamId()])
  const seed = await roomSeed(db, raw, steamid)
  const headers = { 'Cache-Control': 'private, no-store' }
  if (!seed) return NextResponse.json({ error: 'noseed' }, { status: 404, headers })
  return NextResponse.json({ appid: seed.appid, name: seed.name }, { headers })
}
