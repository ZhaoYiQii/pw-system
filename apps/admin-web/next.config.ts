import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 关闭 Next 自动生成 AGENTS.md/CLAUDE.md（本地开发噪音）
  agentRules: false
};

export default nextConfig;
