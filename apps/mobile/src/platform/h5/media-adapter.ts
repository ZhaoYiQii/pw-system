import type { ChosenImage, MediaAdapter } from "../contracts/media";

/** H5 图片选择：文件读取仅在用户交互触发时执行。 */
export const mediaAdapter: MediaAdapter = {
  chooseImage(): Promise<ChosenImage> {
    return new Promise((resolvePromise, rejectPromise) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return rejectPromise(new Error("未选择文件"));
        void file
          .arrayBuffer()
          .then((buffer) =>
            resolvePromise({
              name: file.name,
              bytes: new Uint8Array(buffer),
            }),
          )
          .catch(rejectPromise);
      };
      input.onerror = () => rejectPromise(new Error("文件读取失败"));
      input.click();
    });
  },
};
