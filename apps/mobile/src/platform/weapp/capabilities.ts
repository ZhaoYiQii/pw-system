import type { PlatformCapabilities } from "../contracts/capabilities";

const unsupportedReason = "NOT_IMPLEMENTED_IN_SLICE_0";

export const capabilities: PlatformCapabilities = {
  identity: { supported: false, reason: unsupportedReason },
  tenantLocator: { supported: false, reason: unsupportedReason },
  media: { supported: false, reason: unsupportedReason },
  share: { supported: false, reason: unsupportedReason },
  notificationPermission: { supported: false, reason: unsupportedReason },
  payment: { supported: false, reason: unsupportedReason }
};
