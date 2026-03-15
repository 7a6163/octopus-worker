/**
 * Transformer registration and retrieval
 */

import type { OutboundType } from '@/types/channel';
import type { InboundTransformer, InboundType, OutboundTransformer } from './interface';

// Registry (implemented incrementally in Phase 1.2-1.4)
const inboundRegistry: Map<string, () => InboundTransformer> = new Map();
const outboundRegistry: Map<number, () => OutboundTransformer> = new Map();

/**
 * Register an inbound transformer
 */
export function registerInbound(type: InboundType, factory: () => InboundTransformer): void {
  inboundRegistry.set(type, factory);
}

/**
 * Register an outbound transformer
 */
export function registerOutbound(type: OutboundType, factory: () => OutboundTransformer): void {
  outboundRegistry.set(type, factory);
}

/**
 * Get an inbound transformer
 */
export function getInboundTransformer(type: InboundType): InboundTransformer {
  const factory = inboundRegistry.get(type);
  if (!factory) {
    throw new Error(`Inbound transformer not found: ${type}`);
  }
  return factory();
}

/**
 * Get an outbound transformer
 */
export function getOutboundTransformer(type: OutboundType): OutboundTransformer {
  const factory = outboundRegistry.get(type);
  if (!factory) {
    throw new Error(`Outbound transformer not found: ${type}`);
  }
  return factory();
}

import { AnthropicInbound } from './inbound/anthropic';
import { OpenAIChatInbound } from './inbound/openai-chat';
import { OpenAIEmbeddingInbound } from './inbound/openai-embedding';
import { OpenAIResponseInbound } from './inbound/openai-response';
import { AnthropicOutbound } from './outbound/anthropic';
import { GeminiOutbound } from './outbound/gemini';
// Auto-register transformers
import { OpenAIChatOutbound } from './outbound/openai-chat';
import { OpenAIEmbeddingOutbound } from './outbound/openai-embedding';
import { OpenAIResponseOutbound } from './outbound/openai-response';
import { VolcengineOutbound } from './outbound/volcengine';

registerOutbound(0, () => new OpenAIChatOutbound()); // OutboundType.OpenAIChat
registerOutbound(1, () => new OpenAIResponseOutbound()); // OutboundType.OpenAIResponse
registerOutbound(2, () => new AnthropicOutbound()); // OutboundType.Anthropic
registerOutbound(3, () => new GeminiOutbound()); // OutboundType.Gemini
registerOutbound(4, () => new VolcengineOutbound()); // OutboundType.Volcengine
registerOutbound(5, () => new OpenAIEmbeddingOutbound()); // OutboundType.OpenAIEmbedding
registerInbound('openai-chat', () => new OpenAIChatInbound());
registerInbound('openai-response', () => new OpenAIResponseInbound());
registerInbound('anthropic', () => new AnthropicInbound());
registerInbound('openai-embedding', () => new OpenAIEmbeddingInbound());
