#!/bin/bash

API_URL="http://localhost:3000/v1/chat/completions"
API_KEY="sk-019cd310-248b-7000-9151-c451967d1480"
ADMIN_KEY="sk-019cd317-5587-7000-94f6-e409253add72"
PROMPT="Say 'OK'"
MAX_TOKENS=10
TIMEOUT=30

echo "=== 全量模型测试 ==="
echo "测试时间: $(date)"
echo ""

# 获取所有模型
MODELS=$(curl -s http://localhost:3000/v1/models \
  -H "Authorization: Bearer $API_KEY" \
  | jq -r '.data[].id' | sort | uniq)

TOTAL=$(echo "$MODELS" | wc -l | tr -d ' ')
SUCCESS=0
FAILED=0

RESULTS_FILE="/tmp/all_models_test.txt"
echo "" > $RESULTS_FILE

echo "总模型数: $TOTAL"
echo ""

printf "%-50s | %-8s | %-10s | %s\n" "模型" "耗时" "Tokens" "状态"
printf "%s\n" "$(printf '%.0s-' {1..95})"

count=0
while IFS= read -r model; do
    [ -z "$model" ] && continue
    count=$((count + 1))
    
    start_time=$(python3 -c "import time; print(time.time())")
    
    response=$(curl -s -w "\n%{http_code}" "$API_URL" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $API_KEY" \
        -d "{\"model\": \"$model\", \"messages\": [{\"role\": \"user\", \"content\": \"$PROMPT\"}], \"max_tokens\": $MAX_TOKENS}" \
        --connect-timeout 5 \
        --max-time $TIMEOUT 2>/dev/null)
    
    end_time=$(python3 -c "import time; print(time.time())")
    http_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | head -n -1)
    
    duration=$(python3 -c "print(f'{$end_time - $start_time:.2f}')")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.choices[0].message.content' > /dev/null 2>&1; then
        tokens=$(echo "$body" | jq -r '.usage.total_tokens // "N/A"')
        printf "\033[32m✅ %-48s\033[0m | %6ss | %-10s | OK\n" "$model" "$duration" "$tokens"
        echo "✅ $model | ${duration}s | $tokens tokens" >> $RESULTS_FILE
        SUCCESS=$((SUCCESS + 1))
    else
        error=$(echo "$body" | jq -r '.message // .error // "Unknown"' 2>/dev/null | head -c 40)
        printf "\033[31m❌ %-48s\033[0m | %6ss | %-10s | %s\n" "$model" "$duration" "N/A" "$error"
        echo "❌ $model | $error" >> $RESULTS_FILE
        FAILED=$((FAILED + 1))
    fi
    
    sleep 0.1
done <<< "$MODELS"

printf "%s\n" "$(printf '%.0s-' {1..95})"
echo ""
echo "=== 测试完成 ==="
echo "总计: $TOTAL | 成功: $SUCCESS | 失败: $FAILED"
echo "成功率: $(python3 -c "print(f'{$SUCCESS * 100 / $TOTAL:.1f}%')")"
echo ""
echo "详细结果已保存到: $RESULTS_FILE"
