import type { DeviceMode } from './types';

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
