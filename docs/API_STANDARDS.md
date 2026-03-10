# API Standards Compatibility

## Current Implementation

### OpenAI API Standards
- ✅ `/v1/chat/completions` - Chat Completions API
- ✅ `/v1/models` - Models List API
- ✅ `/v1/embeddings` - Embeddings API
- ✅ `/v1/images/generations` - Image Generations API
- ✅ `/v1/audio/speech` - Text-to-Speech API
- ✅ `/v1/audio/transcriptions` - Speech-to-Text API
- ✅ `/v1/audio/translations` - Audio Translation API

### Anthropic API Standards
- ✅ `/v1/messages` - Messages API

### Other APIs
- ✅ `/v1/rerank` - Rerank API (Cohere compatible)
- ✅ `/v1/video/generations` - Video Generation API
- ⚠️ Midjourney API (non-standard, `/api/mj/*`)

## Missing API Standards

### OpenAI Missing Endpoints
- ❌ `/v1/completions` - Legacy Completions API (deprecated but still used)
- ❌ `/v1/edits` - Edits API (deprecated)
- ❌ `/v1/moderations` - Moderations API
- ❌ `/v1/files` - Files API (for fine-tuning)
- ❌ `/v1/fine-tunes` - Fine-tuning API
- ❌ `/v1/assistants` - Assistants API
- ❌ `/v1/threads` - Threads API
- ❌ `/v1/runs` - Runs API

### Google Gemini API Standards
- ❌ `/v1beta/models/{model}:generateContent` - Gemini Generate Content
- ❌ `/v1beta/models/{model}:streamGenerateContent` - Gemini Streaming

### Cohere API Standards
- ❌ `/v1/generate` - Cohere Generate API
- ✅ `/v1/rerank` - Cohere Rerank API (already implemented)

### Mistral API Standards
- ❌ `/v1/chat/completions` - Mistral Chat (OpenAI compatible)

## Recommendations

1. **Priority 1 - Add Legacy Completions API**
   - Many older applications still use `/v1/completions`
   - Should be added for backward compatibility

2. **Priority 2 - Add Moderations API**
   - Useful for content filtering
   - Required by many enterprise applications

3. **Priority 3 - Add Assistants API**
   - New OpenAI feature for building AI assistants
   - Includes threads, runs, and messages

4. **Priority 4 - Add Gemini API Support**
   - Google's Gemini models are gaining popularity
   - Different API format from OpenAI

5. **Priority 5 - Add Files and Fine-tuning API**
   - Required for custom model training
   - Enterprise feature

## Implementation Plan

### Phase 1: Fix Current Issues
- Fix embeddings, images, audio routes to use decrypted keys
- Ensure all routes use standard `/v1` prefix
- Add proper error handling

### Phase 2: Add Missing OpenAI APIs
- Add `/v1/completions` endpoint
- Add `/v1/moderations` endpoint
- Add `/v1/assistants` endpoints

### Phase 3: Add Multi-Provider Support
- Add Gemini API support
- Add Cohere Generate API
- Add Mistral API support

### Phase 4: Add Enterprise Features
- Add Files API
- Add Fine-tuning API
- Add Batch API
