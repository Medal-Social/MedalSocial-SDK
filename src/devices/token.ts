import type { DeviceMode } from "./types";

export interface DeviceTokenPayload {
  deviceId: string;
  workspaceId: string;
  mode: DeviceMode;
  capabilities: string[];
  iat: number;
  exp: number;
}

export interface DeviceRegistration {
  deviceId: string;
  workspaceId: string;
  token: string;
  websocketUrl: string;
}
