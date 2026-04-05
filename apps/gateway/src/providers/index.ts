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
import { NvidiaApiHandler } from './nvidia';
import { ComfyUIProviderHandler } from './comfyui';
import { DakkaApiHandler } from './dakka';
import { ZhipuProvider } from './zhipu';

export function getProviderHandler(type: number, baseUrl?: string): ProviderHandler {
    switch (type) {
        case ChannelType.GEMINI: return GeminiApiHandler;
        case ChannelType.ANTHROPIC: return AnthropicApiHandler;
        case ChannelType.AZURE: return AzureOpenAIApiHandler;
        case ChannelType.BAIDU: return BaiduApiHandler;
        case ChannelType.ALI: return AliApiHandler;
        case ChannelType.XUNFEI: return XunfeiApiHandler;
        case ChannelType.MIDJOURNEY: return MidjourneyApiHandler;
        case ChannelType.DEEPSEEK: return DeepSeekApiHandler;
        case ChannelType.SUNO: return SunoApiHandler;
        case ChannelType.FLUX: return FluxApiHandler;
        case ChannelType.JINA: return JinaApiHandler;
        case ChannelType.UDIO: return UdioApiHandler;
        case ChannelType.NVIDIA: return NvidiaApiHandler;
        case ChannelType.DAKKA: return DakkaApiHandler;
        case ChannelType.COMFYUI: return ComfyUIProviderHandler;
        // We can safely route everything else (including OpenAI standard) to OpenAIApiHandler.
        // Kling can be managed in video router specifically if it doesn't have a unique enum,
        // but default handles standard passthrough.
        case ChannelType.OPENAI:
        default: {
            if (baseUrl?.includes('bigmodel.cn')) {
                return ZhipuProvider;
            }
            return OpenAIApiHandler;
        }
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
export * from './nvidia';
export * from './dakka';
export * from './zhipu';
