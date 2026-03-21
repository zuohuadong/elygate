import { ProviderHandler } from './types';

/**
 * ComfyUI Provider Handler
 * Supports both standard DALL-E style requests (mapped to a default workflow)
 * and template-based workflow execution.
 */
export class ComfyUIProviderHandler implements ProviderHandler {
    
    // In a real implementation, we might want to fetch templates from DB.
    // Since transformRequest is sync in the current architecture, we either:
    // 1. Pre-load templates into memory/cache
    // 2. Make ProviderHandler async
    // 3. Handle template resolution in the Dispatcher before calling the provider.
    // For now, we implement the structure and use standard image mapping as a baseline.

    transformRequest(body: Record<string, any>, model: string) {
        // If this is a template-based request
        if (body.template_id) {
            // This part expects the template to have been 'resolved' or 'injected' 
            // before reaching this point, or we handle the raw workflow if passed in.
            return {
                prompt: body.workflow || {},
                client_id: body.client_id || 'elygate-client'
            };
        }

        // Default mapping for standard image generation to a simple ComfyUI workflow
        // This is a simplified "GrsAI" style prompt for ComfyUI
        return {
            prompt: {
                "3": {
                    "class_type": "KSampler",
                    "inputs": {
                        "cfg": 8,
                        "denoise": 1,
                        "latent_image": ["5", 0],
                        "model": ["4", 0],
                        "negative": ["7", 0],
                        "positive": ["6", 0],
                        "sampler_name": "euler",
                        "scheduler": "normal",
                        "seed": body.seed || Math.floor(Math.random() * 1000000),
                        "steps": body.steps || 20
                    }
                },
                "4": {
                    "class_type": "CheckpointLoaderSimple",
                    "inputs": {
                        "ckpt_name": model // Usually the model name maps to a checkpoint
                    }
                },
                "5": {
                    "class_type": "EmptyLatentImage",
                    "inputs": {
                        "batch_size": 1,
                        "height": 512, // Default
                        "width": 512
                    }
                },
                "6": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "clip": ["4", 1],
                        "text": body.prompt
                    }
                },
                "7": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "clip": ["4", 1],
                        "text": body.negative_prompt || "text, watermark"
                    }
                },
                "8": {
                    "class_type": "VAEDecode",
                    "inputs": {
                        "samples": ["3", 0],
                        "vae": ["4", 2]
                    }
                },
                "9": {
                    "class_type": "SaveImage",
                    "inputs": {
                        "filename_prefix": "elygate",
                        "images": ["8", 0]
                    }
                }
            },
            client_id: "elygate-gateway"
        };
    }

    transformResponse(data: Record<string, any>) {
        // ComfyUI usually returns a prompt_id or results depending on the endpoint.
        // If it's the direct /prompt endpoint:
        if (data.prompt_id) {
            return {
                id: data.prompt_id,
                object: "image.generation",
                created: Math.floor(Date.now() / 1000),
                data: [], // Results come later via status check
                status: "queued"
            };
        }

        // If it's a finished task response (standardized by a proxy or worker)
        return {
            created: Math.floor(Date.now() / 1000),
            data: (data.images || []).map((img: Record<string, any>) => ({
                url: typeof img === 'string' ? img : img.url
            }))
        };
    }

    extractUsage(data: Record<string, any>) {
        // Image generation usually counts as 1 per image/workflow execution
        return {
            promptTokens: 1,
            completionTokens: 0
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        if (apiKey) {
            headers.set('Authorization', `Bearer ${apiKey}`);
        }
        return headers;
    }
}
