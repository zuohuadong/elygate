import type { ElygateLocale } from './i18n';

const columnTranslations: Record<ElygateLocale, Record<string, string>> = {
	'zh-CN': {
		id: 'ID',
		request_id: '请求 ID',
		provider: '供应商',
		name: '名称',
		model: '模型',
		timestamp: '时间',
		status: '状态',
		status_code: '状态码',
		method: '方法',
		path: '路径',
		content: '内容',
		latency: '延迟',
		duration: '耗时',
		prompt_tokens: '输入 Token',
		completion_tokens: '输出 Token',
		total_tokens: '总 Token',
		cost: '成本',
	},
	en: {
		id: 'ID',
		request_id: 'Request ID',
		provider: 'Provider',
		name: 'Name',
		model: 'Model',
		timestamp: 'Timestamp',
		status: 'Status',
		status_code: 'Status code',
		method: 'Method',
		path: 'Path',
		content: 'Content',
		latency: 'Latency',
		duration: 'Duration',
		prompt_tokens: 'Input tokens',
		completion_tokens: 'Output tokens',
		total_tokens: 'Total tokens',
		cost: 'Cost',
	},
};

export function columnLabelFor(locale: ElygateLocale, column: string): string {
	const translated = columnTranslations[locale][column];
	if (translated) return translated;
	if (locale === 'zh-CN') return column;
	const words = column.replace(/[_-]+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : column;
}
