-- Phase 10: Unified Model Mapping
-- Standardize model names across all channels

-- Channel 1: NVIDIA
UPDATE channels SET model_mapping = '{
  "GLM-5": "z-ai/glm5",
  "GLM-4.7": "z-ai/glm4.7",
  "Kimi-K2-Instruct": "moonshotai/kimi-k2-instruct",
  "Kimi-K2-Thinking": "moonshotai/kimi-k2-thinking",
  "Kimi-K2.5": "moonshotai/kimi-k2.5",
  "DeepSeek-V3.1": "deepseek-ai/deepseek-v3.1",
  "DeepSeek-V3.2": "deepseek-ai/deepseek-v3.2",
  "DeepSeek-R1-Distill-Qwen-32B": "deepseek-ai/deepseek-r1-distill-qwen-32b",
  "DeepSeek-R1-Distill-Qwen-14B": "deepseek-ai/deepseek-r1-distill-qwen-14b",
  "DeepSeek-R1-Distill-Qwen-7B": "deepseek-ai/deepseek-r1-distill-qwen-7b",
  "Qwen3.5-122B-A10B": "qwen/qwen3.5-122b-a10b",
  "Qwen3.5-397B-A17B": "qwen/qwen3.5-397b-a17b",
  "Qwen3-Next-80B-A3B-Instruct": "qwen/qwen3-next-80b-a3b-instruct",
  "QwQ-32B": "qwen/qwq-32b",
  "Llama-3.1-70B-Instruct": "meta/llama-3.1-70b-instruct",
  "Llama-3.1-8B-Instruct": "meta/llama-3.1-8b-instruct",
  "Llama-3.3-70B-Instruct": "meta/llama-3.3-70b-instruct",
  "Phi-3.5-Mini-Instruct": "microsoft/phi-3.5-mini-instruct",
  "Mistral-Large": "mistralai/mistral-large",
  "Yi-Large": "01-ai/yi-large",
  "ChatGLM3-6B": "thudm/chatglm3-6b",
  "Step-3.5-Flash": "stepfun-ai/step-3.5-flash"
}'::jsonb WHERE id = 1;

-- Channel 3: SiliconFlow
UPDATE channels SET model_mapping = '{
  "GLM-5": "Pro/zai-org/GLM-5",
  "GLM-4.7": "Pro/zai-org/GLM-4.7",
  "GLM-4.6": "zai-org/GLM-4.6",
  "GLM-4.6V": "zai-org/GLM-4.6V",
  "GLM-4.5V": "zai-org/GLM-4.5V",
  "GLM-4.5-Air": "zai-org/GLM-4.5-Air",
  "Kimi-K2-Instruct": "moonshotai/Kimi-K2-Instruct-0905",
  "Kimi-K2-Thinking": "moonshotai/Kimi-K2-Thinking",
  "Kimi-K2.5": "Pro/moonshotai/Kimi-K2.5",
  "DeepSeek-V3": "deepseek-ai/DeepSeek-V3",
  "DeepSeek-V3.1-Terminus": "deepseek-ai/DeepSeek-V3.1-Terminus",
  "DeepSeek-V3.2": "deepseek-ai/DeepSeek-V3.2",
  "DeepSeek-R1": "deepseek-ai/DeepSeek-R1",
  "DeepSeek-R1-Distill-Qwen-32B": "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
  "DeepSeek-R1-Distill-Qwen-14B": "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
  "DeepSeek-R1-Distill-Qwen-7B": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
  "Qwen3.5-4B": "Qwen/Qwen3.5-4B",
  "Qwen3.5-9B": "Qwen/Qwen3.5-9B",
  "Qwen3.5-27B": "Qwen/Qwen3.5-27B",
  "Qwen3.5-35B-A3B": "Qwen/Qwen3.5-35B-A3B",
  "Qwen3.5-122B-A10B": "Qwen/Qwen3.5-122B-A10B",
  "Qwen3.5-397B-A17B": "Qwen/Qwen3.5-397B-A17B",
  "Qwen3-8B": "Qwen/Qwen3-8B",
  "Qwen3-14B": "Qwen/Qwen3-14B",
  "Qwen3-32B": "Qwen/Qwen3-32B",
  "Qwen3-Next-80B-A3B-Instruct": "Qwen/Qwen3-Next-80B-A3B-Instruct",
  "Qwen3-VL-8B-Instruct": "Qwen/Qwen3-VL-8B-Instruct",
  "Qwen3-VL-32B-Instruct": "Qwen/Qwen3-VL-32B-Instruct",
  "Qwen3-Coder-30B-A3B-Instruct": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  "Qwen3-Coder-480B-A35B-Instruct": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
  "QwQ-32B": "Qwen/QwQ-32B",
  "Qwen2.5-7B-Instruct": "Qwen/Qwen2.5-7B-Instruct",
  "Qwen2.5-14B-Instruct": "Qwen/Qwen2.5-14B-Instruct",
  "Qwen2.5-32B-Instruct": "Qwen/Qwen2.5-32B-Instruct",
  "Qwen2.5-72B-Instruct": "Qwen/Qwen2.5-72B-Instruct",
  "Qwen2.5-Coder-7B-Instruct": "Qwen/Qwen2.5-Coder-7B-Instruct",
  "Qwen2.5-Coder-32B-Instruct": "Qwen/Qwen2.5-Coder-32B-Instruct",
  "Qwen2.5-VL-32B-Instruct": "Qwen/Qwen2.5-VL-32B-Instruct",
  "Qwen2.5-VL-72B-Instruct": "Qwen/Qwen2.5-VL-72B-Instruct",
  "Step-3.5-Flash": "stepfun-ai/Step-3.5-Flash",
  "MiniMax-M2.1": "Pro/MiniMaxAI/MiniMax-M2.1",
  "MiniMax-M2.5": "Pro/MiniMaxAI/MiniMax-M2.5",
  "GLM-4-9B-Chat": "THUDM/glm-4-9b-chat",
  "GLM-4-32B": "THUDM/GLM-4-32B-0414",
  "GLM-Z1-9B": "THUDM/GLM-Z1-9B-0414",
  "GLM-Z1-32B": "THUDM/GLM-Z1-32B-0414",
  "FLUX.1-schnell": "black-forest-labs/FLUX.1-schnell",
  "FLUX.1-dev": "black-forest-labs/FLUX.1-dev",
  "BGE-M3": "BAAI/bge-m3",
  "BGE-Reranker-V2-M3": "BAAI/bge-reranker-v2-m3"
}'::jsonb WHERE id = 3;

-- Channel 6: autogit
UPDATE channels SET model_mapping = '{
  "GLM-5": "zai-org/GLM-5",
  "Qwen3.5-122B-A10B": "Qwen/Qwen3.5-122B-A10B",
  "Qwen3.5-397B-A17B": "Qwen/Qwen3.5-397B-A17B"
}'::jsonb WHERE id = 6;

-- Channel 4: Gemini (Google models)
UPDATE channels SET model_mapping = '{
  "Gemini-2.5-Flash": "models/gemini-2.5-flash",
  "Gemini-2.5-Pro": "models/gemini-2.5-pro",
  "Gemini-2.0-Flash": "models/gemini-2.0-flash",
  "Gemini-2.0-Flash-Lite": "models/gemini-2.0-flash-lite",
  "Gemma-3-1B-IT": "models/gemma-3-1b-it",
  "Gemma-3-4B-IT": "models/gemma-3-4b-it",
  "Gemma-3-12B-IT": "models/gemma-3-12b-it",
  "Gemma-3-27B-IT": "models/gemma-3-27b-it"
}'::jsonb WHERE id = 4;
