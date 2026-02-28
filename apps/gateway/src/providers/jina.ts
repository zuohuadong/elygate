import { ProviderHandler } from './types';

/**
 * Jina Rerank API Handler
 * Compatible with Jina AI /v1/rerank
 */
export class JinaApiHandler implements ProviderHandler {
    transformRequest(body: Record<string, any>, model: string) {
        return {
            model: model,
            query: body.query,
            documents: body.documents,
            top_n: body.top_n,
            return_documents: body.return_documents ?? true
        };
    }

    transformResponse(data: any) {
        // Jina response is already close to standard rerank format
        return data;
    }

    extractUsage(data: any) {
        // Rerank usually billed per document or fixed
        return {
            promptTokens: data.usage?.total_tokens || (data.results?.length || 0),
            completionTokens: 0,
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}
