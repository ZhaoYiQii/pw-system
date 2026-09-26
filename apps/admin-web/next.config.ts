import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 关闭 Next 自动生成 AGENTS.md/CLAUDE.md（本地开发噪音）
  agentRules: false,
  // 允许从 127.0.0.1 访问 dev 资源。Next 16 默认拦截跨域 dev 请求（/_next/hmr 等），
  // 被拦后页面照常渲染但**不会 hydrate**（登录按钮会退化成原生表单提交）。
  // 本机 API 的 CORS 白名单放行的也是 http://127.0.0.1:3100，故统一用 127.0.0.1 访问。
  allowedDevOrigins: ["127.0.0.1"],
  // Linux 容器化部署：standalone 自包含产物（monorepo 需从仓库根追踪依赖）
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // 直接消费工作区内的 TS 源码包（生成客户端），由 Next 负责转译。
  transpilePackages: ["@pw/api-client"],
};

export default nextConfig;
