import type { DesiredState, ReportedState } from "./state";
import type { ConsentGrants, DeviceCapabilities } from "./types";

// Device -> Cloud messages
export interface RegisterMessage {
  type: "register";
  deviceId: string;
  capabilities: DeviceCapabilities;
  osVersion: string;
  reportedState: ReportedState;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  deviceId: string;
  status: "online" | "updating";
  uptime: string;
  storage: { usedGb: number; totalGb: number };
  temperatureC: number | null;
  activeApp: string | null;
  wifiSignal: number | null;
}

export interface SyncRequestMessage {
  type: "sync_request";
  deviceId: string;
  currentConfigVersion: number;
}

export interface StateReportMessage {
  type: "state_report";
  deviceId: string;
  reportedState: ReportedState;
}

export interface DeviceEventMessage {
  type: "event";
  deviceId: string;
  event: "content_changed" | "error" | "ota_complete" | "app_installed" | "consent_updated";
  details: Record<string, unknown>;
}

export type DeviceToCloudMessage =
  | RegisterMessage
  | HeartbeatMessage
  | SyncRequestMessage
  | StateReportMessage
  | DeviceEventMessage;

// Cloud -> Device messages
export interface DesiredStateMessage {
  type: "desired_state";
  state: DesiredState;
  delta: boolean;
}

export interface PushContentMessage {
  type: "push_content";
  collectionId: string;
  images: Array<{ id: string; url: string; metadata?: Record<string, unknown> }>;
}

export interface PushConfigMessage {
  type: "push_config";
  config: Partial<DesiredState["config"]>;
}

export interface PushSkillsMessage {
  type: "push_skills";
  skills: Array<{ name: string; version: string; url: string }>;
}

export interface CommandMessage {
  type: "command";
  command: "restart" | "update" | "lock" | "wipe" | "identify" | "rollback";
  params?: Record<string, unknown>;
}

export interface OtaAvailableMessage {
  type: "ota_available";
  version: string;
  downloadUrl: string;
  changelog: string;
  priority: "low" | "normal" | "critical";
}

export interface AckMessage {
  type: "ack";
  replyTo: string;
  status: "ok" | "error";
  error?: string;
}

export type CloudToDeviceMessage =
  | DesiredStateMessage
  | PushContentMessage
  | PushConfigMessage
  | PushSkillsMessage
  | CommandMessage
  | OtaAvailableMessage
  | AckMessage;
