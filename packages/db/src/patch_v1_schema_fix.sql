-- Update cn-safe to use whitelist policy
UPDATE user_groups 
SET denied_models = '["*"]', 
    allowed_models = '["qwen*", "glm*", "chatglm*", "cogview*", "ernie*", "eb*", "moonshot*", "kimi*", "deepseek*", "doubao*", "hunyuan*", "minimax*", "abab*", "spark*", "yi*", "step*", "baichuan*"]'
WHERE key = 'cn-safe';
