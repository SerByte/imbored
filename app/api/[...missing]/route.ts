import { NextResponse } from 'next/server'

/**
 * Адрес под /api, которого нет: JSON-404, как у остальных ручек.
 *
 * Без этой ловушки /api/nope находил чужой маршрут — /[lang]/[...missing] с
 * языком «api», — корневой layout отвечал на чужой язык notFound(), и 404
 * рисовать было уже не в чем: клиент, ждавший JSON, получал стоковую
 * HTML-страницу Next. А /api/portrait/<id>/card.png и вовсе доходил до
 * обработчика карточки портрета под языком «api». Статический сегмент api
 * важнее динамического [lang], и любой адрес под /api, не нашедший своей
 * ручки, заканчивается здесь. Правило мусорных адресов в next.config /api не
 * трогает (garbageRewrites в lib/i18nroutes.ts) — именно ради этого ответа.
 *
 * Все методы: POST на несуществующую ручку — тоже «нет такой», а не 405.
 * Сверку Origin изменяющих запросов прокси делает раньше, на всём /api.
 */
function missing(): NextResponse {
  return NextResponse.json({ error: 'notfound' }, { status: 404 })
}

export const GET = missing
export const POST = missing
export const PUT = missing
export const PATCH = missing
export const DELETE = missing
