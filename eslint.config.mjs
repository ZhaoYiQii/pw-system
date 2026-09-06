import base from "@pw/eslint-config";

export default [
  ...base,
  {
    // G3：业务页/feature 只依赖 platform contracts；网络与平台存储入口收敛到适配层。
    files: [
      "apps/mobile/src/pages/**/*.{ts,tsx}",
      "apps/mobile/src/features/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Taro",
          property: "request",
          message: "网络请求请走 @platform-api 适配器",
        },
        {
          object: "Taro",
          property: "getLocation",
          message: "定位请走 platform location 适配层",
        },
        {
          object: "Taro",
          property: "uploadFile",
          message: "上传请走 platform media 适配层",
        },
        {
          object: "Taro",
          property: "downloadFile",
          message: "下载请走 platform media 适配层",
        },
        {
          object: "Taro",
          property: "getStorage",
          message: "存储请走 platform session 适配层",
        },
        {
          object: "Taro",
          property: "setStorage",
          message: "存储请走 platform session 适配层",
        },
        {
          object: "Taro",
          property: "getStorageSync",
          message: "存储请走 platform session 适配层",
        },
        {
          object: "Taro",
          property: "setStorageSync",
          message: "存储请走 platform session 适配层",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: 'CallExpression[callee.name="fetch"]',
          message: "fetch 只允许出现在 platform/h5 适配层",
        },
      ],
    },
  },
];
