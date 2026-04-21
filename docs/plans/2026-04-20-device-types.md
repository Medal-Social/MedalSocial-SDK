# Device Types & WebSocket Messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add device management types and WebSocket message schemas to the Medal Social SDK so all repos share one source of truth for device communication.

**Architecture:** New `src/devices/` module alongside the existing `src/index.ts`. Exports device types, WebSocket message schemas, and state interfaces. No runtime dependencies — pure TypeScript types + a few validation helpers.

**Tech Stack:** TypeScript, tsup (existing build), Vitest (existing tests)

**Spec:** Picasso repo `docs/superpowers/specs/2026-04-20-kit-medal-social-integration-design.md` — Sections 4, 5, 6

---

### Task 1: Device core types

**Files:**
- Create: `src/devices/types.ts`
- Modify: `src/index.ts` (re-export)

- [ ] **Step 1: Create device types file**

```typescript
// src/devices/types.ts

export type DeviceMode = 'medal-os' | 'pilot';
export type DeviceModel = 'frame-13' | 'frame-28' | 'frame-31' | 'frame-40' | 'studio' | 'canvas' | 'mac' | 'linux';
export type DisplayType = 'eink' | 'ips' | 'hdmi' | 'none';
export type InputMode = 'touch' | 'bezel-gesture' | 'remote' | 'keyboard-mouse';
export type DeviceStatus = 'online' | 'offline' | 'updating';

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
```

- [ ] **Step 2: Re-export from index.ts**

Add to bottom of `src/index.ts`:
```typescript
export * from './devices/types';
```

- [ ] **Step 3: Run build and verify**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/devices/types.ts src/index.ts && git commit -m "feat: add device core types — identity, capabilities, consent"
```

---

### Task 2: Device state types

**Files:**
- Create: `src/devices/state.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create state types**

```typescript
// src/devices/state.ts

import type { DeviceModel, DeviceMode } from './types';

export interface GalleryConfig {
  collection: string;
  rotationInterval: string;
  shuffle: boolean;
  transition: 'fade' | 'cut' | 'slide' | 'dissolve';
  sleep: { start: string; end: string } | null;
  imageFit: 'fill' | 'fit' | 'center-crop';
}

export interface DisplayConfig {
  brightness: number | 'auto';
  colorTemp: number | 'auto';
  ambientLight: boolean;
}

export interface DesiredState {
  deviceId: string;
  workspaceId: string;
  config: {
    name: string;
    mode: string;
    display: DisplayConfig;
    gallery?: GalleryConfig;
    modulesEnabled: string[];
  };
  content: {
    collections: Array<{
      id: string;
      images: string[];
      source: string;
    }>;
  };
  os: {
    targetVersion: string;
    autoUpdate: boolean;
  };
  version: number;
}

export interface ReportedState {
  deviceId: string;
  osVersion: string;
  uptime: string;
  storage: { usedGb: number; totalGb: number };
  temperatureC: number | null;
  activeApp: string | null;
  activeImage: string | null;
  wifiSignal: number | null;
  lastContentSync: string | null;
  configVersion: number;
}
```

- [ ] **Step 2: Re-export from index.ts**

```typescript
export * from './devices/state';
```

- [ ] **Step 3: Build and commit**

```bash
pnpm build && git add src/devices/state.ts src/index.ts && git commit -m "feat: add desired state and reported state types"
```

---

### Task 3: WebSocket message types

**Files:**
- Create: `src/devices/messages.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create message types**

```typescript
// src/devices/messages.ts

import type { DeviceCapabilities, ConsentGrants } from './types';
import type { DesiredState, ReportedState } from './state';

// Device → Cloud messages
export interface RegisterMessage {
  type: 'register';
  deviceId: string;
  capabilities: DeviceCapabilities;
  osVersion: string;
  reportedState: ReportedState;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  deviceId: string;
  status: 'online' | 'updating';
  uptime: string;
  storage: { usedGb: number; totalGb: number };
  temperatureC: number | null;
  activeApp: string | null;
  wifiSignal: number | null;
}

export interface SyncRequestMessage {
  type: 'sync_request';
  deviceId: string;
  currentConfigVersion: number;
}

export interface StateReportMessage {
  type: 'state_report';
  deviceId: string;
  reportedState: ReportedState;
}

export interface DeviceEventMessage {
  type: 'event';
  deviceId: string;
  event: 'content_changed' | 'error' | 'ota_complete' | 'app_installed' | 'consent_updated';
  details: Record<string, unknown>;
}

export type DeviceToCloudMessage =
  | RegisterMessage
  | HeartbeatMessage
  | SyncRequestMessage
  | StateReportMessage
  | DeviceEventMessage;

// Cloud → Device messages
export interface DesiredStateMessage {
  type: 'desired_state';
  state: DesiredState;
  delta: boolean;
}

export interface PushContentMessage {
  type: 'push_content';
  collectionId: string;
  images: Array<{ id: string; url: string; metadata?: Record<string, unknown> }>;
}

export interface PushConfigMessage {
  type: 'push_config';
  config: Partial<DesiredState['config']>;
}

export interface PushSkillsMessage {
  type: 'push_skills';
  skills: Array<{ name: string; version: string; url: string }>;
}

export interface CommandMessage {
  type: 'command';
  command: 'restart' | 'update' | 'lock' | 'wipe' | 'identify' | 'rollback';
  params?: Record<string, unknown>;
}

export interface OtaAvailableMessage {
  type: 'ota_available';
  version: string;
  downloadUrl: string;
  changelog: string;
  priority: 'low' | 'normal' | 'critical';
}

export interface AckMessage {
  type: 'ack';
  replyTo: string;
  status: 'ok' | 'error';
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
```

- [ ] **Step 2: Re-export from index.ts**

```typescript
export * from './devices/messages';
```

- [ ] **Step 3: Build and commit**

```bash
pnpm build && git add src/devices/messages.ts src/index.ts && git commit -m "feat: add WebSocket message types — device-to-cloud and cloud-to-device"
```

---

### Task 4: Device token types and barrel export

**Files:**
- Create: `src/devices/token.ts`
- Create: `src/devices/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create token types**

```typescript
// src/devices/token.ts

import type { DeviceMode } from './types';

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
```

- [ ] **Step 2: Create barrel export**

```typescript
// src/devices/index.ts
export * from './types';
export * from './state';
export * from './messages';
export * from './token';
```

- [ ] **Step 3: Update main index.ts to use barrel**

Replace the three separate re-exports with:
```typescript
export * from './devices';
```

- [ ] **Step 4: Build, test, commit**

```bash
pnpm build && pnpm test && git add src/devices/ src/index.ts && git commit -m "feat: device token types and barrel export"
```
