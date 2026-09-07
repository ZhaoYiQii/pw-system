import type { ChosenImage, MediaAdapter } from "../contracts/media";

/** H5 媒体选择：文件读取仅在用户交互触发时执行；capture 时优先调用摄像头。 */
export const mediaAdapter: MediaAdapter = {
  chooseEvidence(options = {}): Promise<ChosenImage> {
    return new Promise((resolvePromise, rejectPromise) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept =
        options.kind === "video"
          ? "video/mp4,video/webm,video/quicktime"
          : "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime";
      if (options.capture) input.setAttribute("capture", "environment");
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return rejectPromise(new Error("未选择文件"));
        void file
          .arrayBuffer()
          .then((buffer) =>
            resolvePromise({
              name: file.name,
              bytes: new Uint8Array(buffer),
              kind: file.type.startsWith("video/") ? "video" : "image",
            }),
          )
          .catch(rejectPromise);
      };
      input.onerror = () => rejectPromise(new Error("文件读取失败"));
      input.click();
    });
  },
};
