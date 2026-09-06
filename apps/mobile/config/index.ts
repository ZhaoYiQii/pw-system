import { defineConfig, type UserConfigExport } from "@tarojs/cli";
import * as path from "path";
import devConfig from "./dev";
import prodConfig from "./prod";

// 编译期按目标平台选择适配实现目录（构建配置文件允许判断 TARO_ENV；
// 业务页面与 feature 一律只依赖 contracts，不直接判断平台）。
const runtimeDir =
  process.env.TARO_ENV === "weapp" ? "src/platform/weapp" : "src/platform/h5";

function applyRuntimeAlias(chain: {
  resolve: { alias: { set: (name: string, target: string) => void } };
}): void {
  chain.resolve.alias.set(
    "@platform-runtime",
    path.join(process.cwd(), runtimeDir, "runtime")
  );
  chain.resolve.alias.set(
    "@platform-locator",
    path.join(process.cwd(), runtimeDir, "tenant-locator")
  );
}

export default defineConfig<"webpack5">(async (merge) => {
  const baseConfig: UserConfigExport<"webpack5"> = {
    projectName: "pw-mobile",
    date: "2026-09-06",
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2
    },
    sourceRoot: "src",
    outputRoot: "dist",
    plugins: [],
    defineConstants: {},
    framework: "react",
    compiler: "webpack5",
    cache: {
      enable: false
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: "module",
            generateScopedName: "[name]__[local]___[hash:base64:5]"
          }
        }
      },
      webpackChain(chain) {
        applyRuntimeAlias(chain);
      }
    },
    h5: {
      publicPath: "/",
      staticDirectory: "static",
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: "css/[name].[hash].css",
        chunkFilename: "css/[name].[chunkhash].css"
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: "module",
            generateScopedName: "[name]__[local]___[hash:base64:5]"
          }
        }
      },
      webpackChain(chain) {
        applyRuntimeAlias(chain);
      }
    }
  };

  if (process.env.NODE_ENV === "development") {
    return merge({}, baseConfig, devConfig);
  }
  return merge({}, baseConfig, prodConfig);
});
