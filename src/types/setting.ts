/**
 * Setting-related type definitions
 */

export interface Setting {
  key: string;
  value: string;
}

export interface Settings {
  proxyUrl: string;
  statsSaveInterval: number;
  corsAllowOrigins: string;
  modelInfoUpdateInterval: number;
  syncLlmInterval: number;
  relayLogKeepPeriod: number;
  relayLogKeepEnabled: boolean;
}

export type SettingKey = keyof Settings;
