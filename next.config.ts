import type { NextConfig } from "next";
import { cspMode, securityHeaders } from "./lib/csp";
import { noindexHeaders } from "./lib/robots";

const nextConfig: NextConfig = {
  // Заголовок сообщал стек каждому, кто спросит, и больше ничего не делал
  poweredByHeader: false,
  async headers() {
    return [
      // Заголовки безопасности и CSP в режиме отчёта; почему так — в lib/csp.ts
      { source: "/:path*", headers: securityHeaders(cspMode(process.env)) },
      // noindex на личных страницах и их карточках; почему заголовком, а не
      // Disallow в robots.txt, — в lib/robots.ts
      ...noindexHeaders(),
    ];
  },
};

export default nextConfig;
