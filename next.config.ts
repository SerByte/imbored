import type { NextConfig } from "next";
import { cspMode, securityHeaders } from "./lib/csp";

const nextConfig: NextConfig = {
  // Заголовок сообщал стек каждому, кто спросит, и больше ничего не делал
  poweredByHeader: false,
  // Заголовки безопасности и CSP в режиме отчёта; почему так — в lib/csp.ts
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(cspMode(process.env)) }];
  },
};

export default nextConfig;
