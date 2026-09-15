import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 关闭 Next 自动生成 AGENTS.md/CLAUDE.md（本地开发噪音）
  agentRules: false,
  // Linux 容器化部署：standalone 自包含产物（monorepo 需从仓库根追踪依赖）
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // 直接消费工作区内的 TS 源码包（生成客户端），由 Next 负责转译。
  transpilePackages: ["@pw/api-client"],
};

export default nextConfig;
