import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 关闭 Next 自动生成 AGENTS.md/CLAUDE.md（本地开发噪音）
  agentRules: false,
  // Linux 容器化部署：standalone 自包含产物（monorepo 需从仓库根追踪依赖）
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
