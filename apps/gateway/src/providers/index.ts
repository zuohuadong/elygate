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
import { OpenRouterApiHandler } from './openrouter';
import { CohereApiHandler } from './cohere';
import { MistralApiHandler } from './mistral';
import { OllamaApiHandler } from './ollama';
import { MoonshotApiHandler } from './moonshot';
import { SiliconFlowApiHandler } from './siliconflow';
import { AwsBedrockApiHandler } from './aws';
import { TencentHunyuanApiHandler } from './tencent';
import { VolcEngineApiHandler } from './volcengine';
import { CloudflareApiHandler } from './cloudflare';
import { DifyApiHandler } from './dify';
import { CozeApiHandler } from './coze';
import { CodexApiHandler } from './codex';

export function getProviderHandler(type: number, baseUrl?: string): ProviderHandler {
    switch (type) {
        case ChannelType.GEMINI: return GeminiApiHandler;
        case ChannelType.ANTHROPIC: return AnthropicApiHandler;
        case ChannelType.AZURE: return AzureOpenAIApiHandler;
        case ChannelType.BAIDU: return BaiduApiHandler;
        case ChannelType.ALI: return AliApiHandler;
        case ChannelType.XUNFEI: return XunfeiApiHandler;
        case ChannelType.MIDJOURNEY: return MidjourneyApiHandler;
        case ChannelType.MIDJOURNEY_PLUS: return MidjourneyApiHandler;
        case ChannelType.DEEPSEEK: return DeepSeekApiHandler;
        case ChannelType.SUNO: return SunoApiHandler;
        case ChannelType.FLUX: return FluxApiHandler;
        case ChannelType.JINA: return JinaApiHandler;
        case ChannelType.UDIO: return UdioApiHandler;
        case ChannelType.NVIDIA: return NvidiaApiHandler;
        case ChannelType.DAKKA: return DakkaApiHandler;
        case ChannelType.COMFYUI: return ComfyUIProviderHandler;
        case ChannelType.OPENROUTER: return OpenRouterApiHandler;
        case ChannelType.COHERE: return CohereApiHandler;
        case ChannelType.MISTRAL: return MistralApiHandler;
        case ChannelType.OLLAMA: return OllamaApiHandler;
        case ChannelType.MOONSHOT: return MoonshotApiHandler;
        case ChannelType.SILICONFLOW: return SiliconFlowApiHandler;
        case ChannelType.AWS: return AwsBedrockApiHandler;
        case ChannelType.TENCENT: return TencentHunyuanApiHandler;
        case ChannelType.VOLCENGINE: return VolcEngineApiHandler;
        case ChannelType.DOUBAO_VIDEO: return VolcEngineApiHandler;
        case ChannelType.CLOUDFLARE: return CloudflareApiHandler;
        case ChannelType.DIFY: return DifyApiHandler;
        case ChannelType.COZE: return CozeApiHandler;
        case ChannelType.CODEX: return CodexApiHandler;
        case ChannelType.XAI: return OpenAIApiHandler;
        case ChannelType.PERPLEXITY: return OpenAIApiHandler;
        case ChannelType.MINIMAX: return OpenAIApiHandler;
        case ChannelType.VERTEX_AI: return GeminiApiHandler;
        case ChannelType.BAIDU_V2: return BaiduApiHandler;
        case ChannelType.KLING: return KlingApiHandler;
        case ChannelType.JIMENG: return OpenAIApiHandler;
        case ChannelType.VIDU: return OpenAIApiHandler;
        case ChannelType.SORA: return OpenAIApiHandler;
        case ChannelType.REPLICATE: return OpenAIApiHandler;
        case ChannelType.OPENAI_MAX:
        case ChannelType.OH_MY_GPT:
        case ChannelType.AILS:
        case ChannelType.AI_PROXY:
        case ChannelType.API2GPT:
        case ChannelType.AIGC2D:
        case ChannelType.QIHOO_360:
        case ChannelType.AI_PROXY_LIBRARY:
        case ChannelType.FASTGPT:
        case ChannelType.LINGYI_WANWU:
        case ChannelType.MOKA_AI:
        case ChannelType.XINFERENCE:
        case ChannelType.SUBMODEL:
            return OpenAIApiHandler;
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
export * from './openrouter';
export * from './cohere';
export * from './mistral';
export * from './ollama';
export * from './moonshot';
export * from './siliconflow';
export * from './aws';
export * from './tencent';
export * from './volcengine';
export * from './cloudflare';
export * from './dify';
export * from './coze';
export * from './codex';
