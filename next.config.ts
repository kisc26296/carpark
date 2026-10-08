import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mqtt 依賴 Node.js 原生模組（net/tls/ws）；iconv-lite 內部用動態 require 載入編碼表，
  // 兩者都不打包、直接用 node_modules，否則 standalone 輸出會漏掉造成執行期找不到模組
  serverExternalPackages: ["mqtt", "iconv-lite"],
  // 打包成獨立可執行檔需要的精簡輸出（server.js + 必要 node_modules）
  output: "standalone",
};

export default nextConfig;
