/**
 * API Key related type definitions
 */

export interface APIKey {
  id: number;
  name: string;
  apiKey: string;
  enabled: boolean;
  expireAt: number;
  maxCost: number;
  supportedModels: string;
  stats?: StatsAPIKey;
}

export interface StatsAPIKey {
  apiKeyId: number;
  inputToken: number;
  outputToken: number;
  inputCost: number;
  outputCost: number;
  waitTime: number;
  requestSuccess: number;
  requestFailed: number;
}

export interface APIKeyCreateRequest {
  name: string;
  expireAt?: number;
  maxCost?: number;
  supportedModels?: string;
}

export interface APIKeyUpdateRequest {
  id: number;
  name?: string;
  enabled?: boolean;
  expireAt?: number;
  maxCost?: number;
  supportedModels?: string;
}
