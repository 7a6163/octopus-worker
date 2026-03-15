/**
 * LLM Model-related type definitions
 */

export interface LLMInfo {
  name: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LLMInfoUpdateRequest {
  name: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}
