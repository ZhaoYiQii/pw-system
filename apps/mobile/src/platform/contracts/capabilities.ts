export interface CapabilityState {
  supported: false;
  reason: string;
}

export interface PlatformCapabilities {
  identity: CapabilityState;
  tenantLocator: CapabilityState;
  media: CapabilityState;
  share: CapabilityState;
  notificationPermission: CapabilityState;
  payment: CapabilityState;
}
