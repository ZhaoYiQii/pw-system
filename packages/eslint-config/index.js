import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * 把预设里 `error` 的规则统一降为 `warn`，其余条目（含预设刻意 `off` 的）原样保留。
 * 逐条降级而不是「全部映射成 warn」：`off` 是预设的明确判断，翻成 warn 等于把
 * 它决定不启用的规则重新打开。`pnpm lint` 没有 `--max-warnings`，所以 warn 只
 * 暴露既有债务、不打断 CI——本轮的意图是让插件生效并被看见，不是一次修完历史告警。
 */
function downgradeErrorsToWarnings(rules) {
  return Object.fromEntries(
    Object.entries(rules ?? {}).map(([rule, level]) => {
      const [severity, ...options] = Array.isArray(level) ? level : [level];
      const isError = severity === "error" || severity === 2;
      return [rule, isError ? ["warn", ...options] : level];
    }),
  );
}

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.turbo/**",
      "**/.next/**",
      // .next.stale-YYYYMMDD 之类的过期构建快照：不是源码，且 glob "**/.next/**" 匹配不到它们。
      "**/.next.*/**",
      "**/dist/**",
      "**/dist-weapp/**",
      "**/lib/**",
      "**/coverage/**",
      "packages/api-client/src/**",
      ".pnpm-store/**",
      ".pnpm-cache/**",
      "pnpm-lock.yaml",
      // 废弃源码快照，不是活代码；启用 jsx-a11y 后只会变成纯噪声源。
      "work/backups/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-undef": "off",
    },
  },
  {
    // 用 tsx/jsx 限定作用面：两套插件对 .ts 无意义，而 jsx-a11y 预设自带
    // `languageOptions.parserOptions.ecmaFeatures.jsx`，不限定会漏进 apps/api 的 .ts。
    ...jsxA11y.flatConfigs.recommended,
    files: ["**/*.{jsx,tsx}"],
    plugins: {
      ...jsxA11y.flatConfigs.recommended.plugins,
      "react-hooks": reactHooks,
    },
    rules: {
      ...downgradeErrorsToWarnings(jsxA11y.flatConfigs.recommended.rules),
      // 只取经典两条，不用 `configs.flat.recommended`：后者带 14 条 React Compiler
      // 规则（多为 error），会在既有 hooks 文件上大面积报错。
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
