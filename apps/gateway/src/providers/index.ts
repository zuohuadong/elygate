import { ChannelType, type ProviderHandler } from './types';
import { OpenAIApiHandler } from './openai';
import { GeminiApiHandler } from './gemini';
import { AnthropicApiHandler } from './anthropic';
import { AzureOpenAIApiHandler } from './azure';
import { BaiduApiHandler } from './baidu';
import { AliApiHandler } from './ali';
import { XunfeiApiHandler } from './xunfei';
import { MidjourneyApiHandler } from './mj';
import { DeepSeekApiHandler } from './deepseek';
import { SunoApiHandler } from './suno';
import { FluxApiHandler } from './flux';
import { JinaApiHandler } from './jina';
import { KlingApiHandler } from './kling';
import { UdioApiHandler } from './udio';

export function getProviderHandler(type: number): ProviderHandler {
    switch (type) {
        case ChannelType.GEMINI: return new GeminiApiHandler();
        case ChannelType.ANTHROPIC: return new AnthropicApiHandler();
        case ChannelType.AZURE: return new AzureOpenAIApiHandler();
        case ChannelType.BAIDU: return new BaiduApiHandler();
        case ChannelType.ALI: return new AliApiHandler();
        case ChannelType.XUNFEI: return new XunfeiApiHandler();
        case ChannelType.MIDJOURNEY: return new MidjourneyApiHandler();
        case ChannelType.DEEPSEEK: return new DeepSeekApiHandler();
        case ChannelType.SUNO: return new SunoApiHandler();
        case ChannelType.FLUX: return new FluxApiHandler();
        case ChannelType.JINA: return new JinaApiHandler();
        case ChannelType.UDIO: return new UdioApiHandler();
        // We can safely route everything else (including OpenAI standard) to OpenAIApiHandler.
        // Kling can be managed in video router specifically if it doesn't have a unique enum,
        // but default handles standard passthrough.
        case ChannelType.OPENAI:
        default: return new OpenAIApiHandler();
    }
}

export * from './types';
export * from './openai';
export * from './gemini';
export * from './anthropic';
export * from './azure';
export * from './baidu';
export * from './ali';
export * from './xunfei';
export * from './mj';
export * from './deepseek';
export * from './suno';
export * from './flux';
export * from './jina';
export * from './kling';
export * from './udio';
