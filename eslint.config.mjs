import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Черновики в scripts/: одноразовые прогоны и симуляции, которые пишут
    // руками или агенты, чтобы что-то посчитать на реальном каталоге. К
    // продукту отношения не имеют и до коммита доживать не должны — см.
    // .gitignore. Правило здесь, чтобы такой черновик не валил линт и CI.
    "scripts/_*",
    // Рабочие копии агентов: Claude Code разворачивает git worktree в
    // .claude/worktrees/<имя>, и в каждой лежит полный чекаут вместе с чужим
    // .next. Линт из корня обходил их все: тысячи ошибок в собранных чанках и
    // чужих ветках, а `npm run lint` выходил с кодом 1 на чистом дереве. Свой
    // код каждая копия линтует сама, из своего корня.
    ".claude/**",
  ]),
  {
    // Анимации — m.* под LazyMotion (components/motion/MotionLazy.tsx): m весит
    // в разы меньше motion.*, а фичи догружаются чанком. Импорт motion.*
    // возвращает всё в первую загрузку. Пакет motion (motion/react) — обёртка,
    // которая сама обращается к motion.* и ломает тришейкинг, поэтому
    // импортируем framer-motion напрямую.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "framer-motion",
              importNames: ["motion"],
              message: "Используй m из framer-motion под MotionLazy (components/motion/MotionLazy.tsx).",
            },
            {
              name: "framer-motion/client",
              message: "Используй framer-motion/m под MotionLazy (components/motion/MotionLazy.tsx).",
            },
          ],
          patterns: [
            {
              regex: "^motion(/|$)",
              message: "Импортируй из framer-motion: motion/react тянет motion.* со всеми фичами (components/motion/MotionLazy.tsx).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
