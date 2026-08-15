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
  ]),
]);

export default eslintConfig;
