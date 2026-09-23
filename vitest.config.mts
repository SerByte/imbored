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
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
})
