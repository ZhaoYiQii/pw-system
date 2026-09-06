import type { MediaAdapter } from "../contracts/media";

/** 小程序媒体选择待真机 AppID/授权后落地；typed unsupported。 */
export const mediaAdapter: MediaAdapter = {
  async chooseImage(): Promise<never> {
    throw new Error("WECHAT_MEDIA_NOT_CONFIGURED");
  },
};
