import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Тот же «@/», что в tsconfig: роуты app/api импортируют через него, и без
    // этой строки их нельзя было бы проверить целиком — только по кусочкам из lib.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    // scripts/ сюда же: это такой же продакшен-код, просто запускаемый руками.
    // Помощник аренды (scripts/lease.ts) разводит ручной прогон с кроном по
    // времени — ошибиться в нём значит либо запереть крон, либо оплатить одну
    // и ту же работу дважды.
    //
    // app/ — ради тестов роутов рядом с самими роутами (app/api/*/route.test.ts,
    // обвязка в lib/testing/route.ts). Next такой файл маршрутом не считает:
    // маршрут — только route.ts и page.tsx. Там же app/**/page.test.ts — тесты
    // серверных страниц деревом, без рендера (app/library/page.test.ts).
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
    // Без глобальных localStorage и sessionStorage — как на CI. CI собирает на
    // node 22 (engines), где их нет, а node 25 и новее выставляет их сам: тест,
    // молча опиравшийся на них, был зелёным у разработчика и падал в PR
    // (lib/unlike.test.ts). Хранилище, которое нужно тесту, он ставит сам
    // через vi.stubGlobal. Флаг понимают и 22-я, и 25-я.
    execArgv: ['--no-experimental-webstorage'],
  },
})
