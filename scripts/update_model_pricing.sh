#!/bin/bash

ADMIN_KEY="sk-019cd317-5587-7000-94f6-e409253add72"
API_URL="http://localhost:3000/api/admin"

echo "=== 更新可用模型列表 ==="
echo ""

# 获取可用模型列表
AVAILABLE_MODELS=$(cat /tmp/available_models.txt)

# 读取当前配置
CURRENT_RATIO=$(curl -s "$API_URL/options/ModelRatio" -H "Authorization: Bearer $ADMIN_KEY" | jq -r '.value // {}')

# 市场价格参考 (每 1K tokens 价格，单位: 美元)
# 基于 OpenAI 和其他主流 API 的定价
declare -A MODEL_PRICES

# OpenAI 模型
MODEL_PRICES["gpt-4o"]=0.005
MODEL_PRICES["gpt-4o-mini"]=0.0003
MODEL_PRICES["gpt-4-turbo"]=0.01
MODEL_PRICES["gpt-3.5-turbo"]=0.0005

# Claude 模型 (Anthropic)
MODEL_PRICES["claude-3-5-sonnet-20241022"]=0.003
MODEL_PRICES["claude-3-5-haiku-20241022"]=0.001

# DeepSeek 模型 (非常便宜)
MODEL_PRICES["deepseek-ai/deepseek-v3.1"]=0.0001
MODEL_PRICES["deepseek-ai/deepseek-r1-distill-llama-8b"]=0.0001

# Qwen 模型
MODEL_PRICES["qwen/qwen2.5-7b-instruct"]=0.0001
MODEL_PRICES["qwen/qwen2.5-32b-instruct"]=0.0003
MODEL_PRICES["qwen/qwen2.5-72b-instruct"]=0.0005
MODEL_PRICES["qwen/qwen2.5-coder-32b-instruct"]=0.0003

# Llama 模型
MODEL_PRICES["meta/llama-3.1-8b-instruct"]=0.0001
MODEL_PRICES["meta/llama-3.1-70b-instruct"]=0.0005
MODEL_PRICES["meta/llama-3.3-70b-instruct"]=0.0005

# Gemini 模型
MODEL_PRICES["gemini-2.5-flash"]=0.0001
MODEL_PRICES["gemini-2.5-pro"]=0.001

# 计算模型比率 (基准: gpt-3.5-turbo = 1, 价格 $0.0005/1K tokens)
# ModelRatio = ModelPrice / BasePrice
BASE_PRICE=0.0005

echo "正在计算模型定价比率..."
echo ""

# 构建 ModelRatio JSON
RATIOS=$(echo "$CURRENT_RATIO" | jq '.')

while IFS= read -r model; do
    [ -z "$model" ] && continue
    
    # 查找匹配的价格
    price=""
    for key in "${!MODEL_PRICES[@]}"; do
        if [[ "$model" == *"$key"* ]] || [[ "$key" == *"$model"* ]]; then
            price="${MODEL_PRICES[$key]}"
            break
        fi
    done
    
    # 如果没有匹配，使用默认价格
    if [ -z "$price" ]; then
        # 根据模型大小估算
        if [[ "$model" == *"70b"* ]] || [[ "$model" == *"72b"* ]]; then
            price=0.0005
        elif [[ "$model" == *"32b"* ]] || [[ "$model" == *"34b"* ]]; then
            price=0.0003
        elif [[ "$model" == *"14b"* ]] || [[ "$model" == *"13b"* ]]; then
            price=0.0002
        elif [[ "$model" == *"8b"* ]] || [[ "$model" == *"7b"* ]]; then
            price=0.0001
        else
            price=0.0005
        fi
    fi
    
    # 计算比率
    ratio=$(python3 -c "print(f'{$price / $BASE_PRICE:.2f}')")
    
    # 添加到 JSON
    RATIOS=$(echo "$RATIOS" | jq --arg model "$model" --argjson ratio "$ratio" '.[$model] = $ratio')
    
    echo "  $model: $ratio (价格: \$$price/1K tokens)"
done <<< "$AVAILABLE_MODELS"

echo ""
echo "正在更新配置..."

# 更新 ModelRatio
curl -s -X POST "$API_URL/options" \
    -H "Authorization: Bearer $ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"key\": \"ModelRatio\", \"value\": $(echo "$RATIOS" | jq -c '.')}" | jq '.'

echo ""
echo "=== 完成 ==="
echo "已更新 $(echo "$AVAILABLE_MODELS" | wc -l) 个模型的定价配置"
