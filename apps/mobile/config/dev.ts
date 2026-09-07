import type { UserConfigExport } from "@tarojs/cli";

export default {
  logger: {
    quiet: false,
    stats: true,
  },
  mini: {},
  h5: {
    // 本地四端联调：H5 固定 3101，并把 /api 代理到本地 API(3100)。
    devServer: {
      port: 3101,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3100",
          changeOrigin: true,
        },
      },
    },
  },
} satisfies UserConfigExport<"webpack5">;
