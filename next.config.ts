import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mqtt 依賴 Node.js 原生模組（net/tls/ws），不打包、直接用 node_modules
  serverExternalPackages: ["mqtt"],
};

export default nextConfig;
