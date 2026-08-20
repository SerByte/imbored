import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // scripts/ сюда же: это такой же продакшен-код, просто запускаемый руками.
    // Помощник аренды (scripts/lease.ts) разводит ручной прогон с кроном по
    // времени — ошибиться в нём значит либо запереть крон, либо оплатить одну
    // и ту же работу дважды.
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
})
