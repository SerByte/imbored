import type { NextConfig } from "next";
import { cspMode, securityHeaders } from "./lib/csp";
import { homeLocaleRedirects } from "./lib/homelocale";
import { garbageRewrites, localeRedirects, localeRewrites } from "./lib/i18nroutes";
import { noindexHeaders } from "./lib/robots";

const nextConfig: NextConfig = {
  // Заголовок сообщал стек каждому, кто спросит, и больше ничего не делал
  poweredByHeader: false,
  experimental: {
    // 404 на адрес, которого нет ни в одном языке (/xyz-nope): корневой
    // layout стоит под [lang], и собрать из него общий 404 нельзя —
    // app/global-not-found.tsx отдаёт двуязычную страницу сам
    globalNotFound: true,
  },
  async headers() {
    return [
      // Заголовки безопасности и CSP в режиме отчёта; почему так — в lib/csp.ts
      { source: "/:path*", headers: securityHeaders(cspMode(process.env)) },
      // noindex на личных страницах, их карточках, секретной RSS-ленте и
      // открытых заглушках шапки (/daily, /rooms); почему заголовком, а не
      // Disallow в robots.txt, — в lib/robots.ts
      ...noindexHeaders(),
    ];
  },
  // Русский — без префикса снаружи и под /ru внутри (app/[lang]); почему
  // rewrites, а не прокси, и что с /ru снаружи — в lib/i18nroutes.ts.
  // Кука lang=en уводит «/» на /en правилом; первый вход без выбора —
  // страна и браузер — решает proxy.ts. Почему так — в lib/homelocale.ts
  async redirects() {
    return [...homeLocaleRedirects(), ...localeRedirects()];
  },
  // beforeFiles — разделы русской ветки, afterFiles — мусорный адрес в
  // статическую 404; почему одно до файлов, а другое после — там же
  async rewrites() {
    return { beforeFiles: localeRewrites(), afterFiles: garbageRewrites(), fallback: [] };
  },
};

export default nextConfig;
