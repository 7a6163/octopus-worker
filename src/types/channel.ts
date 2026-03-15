/**
 * Channel-related type definitions
 * Corresponds to internal/model/channel.go in the original Go project
 */

export enum OutboundType {
  OpenAIChat = 0,
  OpenAIResponse = 1,
  Anthropic = 2,
  Gemini = 3,
  Volcengine = 4,
  OpenAIEmbedding = 5,
}

export enum AutoGroupType {
  None = 0,
  Fuzzy = 1,
  Exact = 2,
  Regex = 3,
}

export interface Channel {
  id: number;
  name: string;
  type: OutboundType;
  enabled: boolean;
  baseUrls: BaseUrl[];
  keys: ChannelKey[];
  model: string;
  customModel: string;
  proxy: boolean;
  autoSync: boolean;
  autoGroup: AutoGroupType;
  customHeader: CustomHeader[];
  paramOverride?: string;
  channelProxy?: string;
  matchRegex?: string;
  stats?: StatsChannel;
}

export interface BaseUrl {
  url: string;
  delay: number;
}

export interface ChannelKey {
  id: number;
  channelId: number;
  enabled: boolean;
  channelKey: string;
  statusCode: number;
  lastUseTimeStamp: number;
  totalCost: number;
  remark: string;
}

export interface CustomHeader {
  headerKey: string;
  headerValue: string;
}

export interface StatsChannel {
  channelId: number;
  inputToken: number;
  outputToken: number;
  inputCost: number;
  outputCost: number;
  waitTime: number;
  requestSuccess: number;
  requestFailed: number;
}

// Channel update request
export interface ChannelUpdateRequest {
  id: number;
  name?: string;
  type?: OutboundType;
  enabled?: boolean;
  baseUrls?: BaseUrl[];
  model?: string;
  customModel?: string;
  proxy?: boolean;
  autoSync?: boolean;
  autoGroup?: AutoGroupType;
  customHeader?: CustomHeader[];
  channelProxy?: string;
  paramOverride?: string;
  matchRegex?: string;
  keysToAdd?: ChannelKeyAddRequest[];
  keysToUpdate?: ChannelKeyUpdateRequest[];
  keysToDelete?: number[];
}

export interface ChannelKeyAddRequest {
  enabled: boolean;
  channelKey: string;
  remark: string;
}

export interface ChannelKeyUpdateRequest {
  id: number;
  enabled?: boolean;
  channelKey?: string;
  remark?: string;
}

export interface ChannelFetchModelRequest {
  type: OutboundType;
  baseUrl: string;
  key: string;
  proxy: boolean;
}
