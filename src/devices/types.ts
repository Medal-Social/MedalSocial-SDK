export type DeviceMode = "medal-os" | "pilot";
export type DeviceModel =
  | "frame-13"
  | "frame-28"
  | "frame-31"
  | "frame-40"
  | "studio"
  | "canvas"
  | "mac"
  | "linux";
export type DisplayType = "eink" | "ips" | "hdmi" | "none";
export type InputMode = "touch" | "bezel-gesture" | "remote" | "keyboard-mouse";
export type DeviceStatus = "online" | "offline" | "updating";

export interface DeviceCapabilities {
  mode: DeviceMode;
  model: DeviceModel;
  displayType: DisplayType;
  inputMode: InputMode;
  hasCamera: boolean;
  hasMicrophone: boolean;
  hasBluetooth: boolean;
  hasNfc: boolean;
}

export interface DeviceIdentity {
  deviceId: string;
  workspaceId: string;
  name: string;
  model: DeviceModel;
  mode: DeviceMode;
  capabilities: DeviceCapabilities;
}

export interface ConsentGrants {
  viewContent: boolean;
  pushContent: boolean;
  changeSettings: boolean;
  remoteWipe: boolean;
}
