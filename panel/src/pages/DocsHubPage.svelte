<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { useTranslation } from '@svadmin/core/i18n';
	import DOMPurify from 'isomorphic-dompurify';
	import { Marked } from 'marked';
	import { markedHighlight } from 'marked-highlight';
	import hljs from 'highlight.js';
	import { applyMediaLoadingHints, normalizeMdxDocument } from '../lib/docs';
	import quickstartSource from 'elygate-doc:quickstart/gateway/setting-up.mdx';
	import architectureSource from 'elygate-doc:architecture/core/request-flow.mdx';
	import mcpOverviewSource from 'elygate-doc:mcp/overview.mdx';
	import mcpGatewaySource from 'elygate-doc:mcp/gateway.mdx';
	import virtualKeysSource from 'elygate-doc:features/governance/virtual-keys.mdx';
	import routingSource from 'elygate-doc:features/governance/routing.mdx';
	import webhooksSource from 'elygate-doc:features/webhooks.mdx';
	import pluginsSource from 'elygate-doc:plugins/getting-started.mdx';
	import deploymentSource from 'elygate-doc:deployment-guides/how-to/security-best-practices.mdx';

	interface Props { resourceName: string; }
	interface DocEntry {
		slug: string;
		title: string;
		description: string;
		category: string;
		sourcePath: string;
		content: string;
	}

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	const markdown = new Marked(markedHighlight({
		emptyLangClass: 'hljs',
		langPrefix: 'hljs language-',
		highlight(code, language) {
			return language && hljs.getLanguage(language)
				? hljs.highlight(code, { language }).value
				: hljs.highlightAuto(code).value;
		},
	}));
	let query = $state('');
	let selectedSlug = $state('quickstart');

	const chineseDocs: Record<string, string> = {
		quickstart: `# 30 秒开始\n\n## 安装与启动\n\n在项目目录执行 \`bun install\`，然后运行 \`bun run dev\`。生产环境请使用固定版本镜像并启用管理员认证。\n\n## 发送第一个请求\n\n先在“供应商”和“供应商密钥”页面保存上游凭据，再创建虚拟密钥。向 \`/v1/chat/completions\` 发送带有 \`Authorization: Bearer <virtual-key>\` 的请求即可验证链路。\n\n## 下一步\n\n在运行概览查看请求、延迟、Token 和成本；在请求日志检查单次调用；在系统设置中配置认证、日志、缓存、代理和 MCP 网关。`,
		architecture: `# 系统架构\n\n请求先经过认证与虚拟密钥解析，再进入路由规则、供应商适配器和响应记录。日志、缓存、Webhook 与可观测性插件在请求生命周期的对应阶段执行。\n\n生产排障时，先检查 \`/health\`、数据库连通性和供应商状态，再查看请求日志中的请求 ID。`,
		'mcp-overview': `# MCP 概览\n\nMCP 客户端连接服务目录中的服务，网关统一处理认证、工具同步、虚拟密钥范围和调用日志。客户端配置与 MCP 网关运行参数分开管理。`,
		'mcp-gateway': `# MCP 网关\n\n在 MCP 网关配置中设置工具同步、执行超时、认证模式和外部客户端地址。保存后，客户端可通过统一端点发现并调用已启用工具。`,
		'virtual-keys': `# 虚拟密钥\n\n虚拟密钥用于隔离用户、供应商和模型访问。为每条供应商路由选择全部密钥或指定密钥，并按需限制模型、预算、限流和有效期。明文密钥只在创建或轮换后显示一次。`,
		routing: `# 治理路由\n\n路由规则支持 CEL 条件、优先级、权重和回退链。先用全局规则验证，再逐步增加用户、团队或虚拟密钥范围。保存前确认每个目标都有有效供应商和模型。`,
		webhooks: `# Webhook 集成\n\nWebhook 用于接收异步任务完成通知。创建端点后选择事件、签名密钥和重试策略；生产环境建议限制目标网络并验证签名。`,
		plugins: `# 插件开发\n\n插件可以扩展请求、响应和日志生命周期。安装后在插件管理页检查加载状态、能力声明和执行顺序；配置保存后启用的插件会立即重新加载。`,
		'production-security': `# 生产安全清单\n\n启用管理员认证，使用强密码和最小权限的虚拟密钥；将允许的跨域来源限制为明确白名单；生产环境不要跳过 TLS 验证。部署后验证健康检查、匿名接口返回 401、日志脱敏和对象存储权限。`,
	};

	const docs = $derived.by<DocEntry[]>(() => {
		const zh = i18n.locale === 'zh-CN';
		return [
			{ slug: 'quickstart', title: zh ? '快速开始' : 'Quick start', description: zh ? '安装、启动并发出第一个请求。' : 'Install, start, and send the first request.', category: zh ? '入门' : 'Start', sourcePath: 'quickstart/gateway/setting-up.mdx', content: zh ? chineseDocs.quickstart : quickstartSource },
			{ slug: 'architecture', title: zh ? '系统架构' : 'Architecture', description: zh ? '理解网关请求链路和核心组件。' : 'Understand the gateway request path and core components.', category: zh ? '核心' : 'Core', sourcePath: 'architecture/core/request-flow.mdx', content: zh ? chineseDocs.architecture : architectureSource },
			{ slug: 'mcp-overview', title: zh ? 'MCP 概览' : 'MCP overview', description: zh ? `连接服务、客户端和 ${getAppName()} 网关。` : `Connect servers, clients, and the ${getAppName()} gateway.`, category: 'MCP', sourcePath: 'mcp/overview.mdx', content: zh ? chineseDocs['mcp-overview'] : mcpOverviewSource },
			{ slug: 'mcp-gateway', title: zh ? 'MCP 网关' : 'MCP gateway', description: zh ? '通过统一端点暴露聚合工具。' : 'Expose aggregated tools through one endpoint.', category: 'MCP', sourcePath: 'mcp/gateway.mdx', content: zh ? chineseDocs['mcp-gateway'] : mcpGatewaySource },
			{ slug: 'virtual-keys', title: zh ? '虚拟密钥' : 'Virtual keys', description: zh ? '访问控制、预算、限流和路由。' : 'Access control, budgets, limits, and routing.', category: zh ? '治理' : 'Governance', sourcePath: 'features/governance/virtual-keys.mdx', content: zh ? chineseDocs['virtual-keys'] : virtualKeysSource },
			{ slug: 'routing', title: zh ? '治理路由' : 'Governance routing', description: zh ? '按供应商、模型和权重分配请求。' : 'Route requests by provider, model, and weight.', category: zh ? '治理' : 'Governance', sourcePath: 'features/governance/routing.mdx', content: zh ? chineseDocs.routing : routingSource },
			{ slug: 'webhooks', title: 'Webhooks', description: zh ? '异步推理完成后的签名回调。' : 'Signed callbacks for completed async inference.', category: zh ? '集成' : 'Integrations', sourcePath: 'features/webhooks.mdx', content: zh ? chineseDocs.webhooks : webhooksSource },
			{ slug: 'plugins', title: zh ? '插件开发' : 'Plugin development', description: zh ? '扩展请求和响应处理生命周期。' : 'Extend the request and response lifecycle.', category: zh ? '扩展' : 'Extensions', sourcePath: 'plugins/getting-started.mdx', content: zh ? chineseDocs.plugins : pluginsSource },
			{ slug: 'production-security', title: zh ? '生产安全清单' : 'Production security', description: zh ? '部署前的认证、网络和密钥检查。' : 'Authentication, network, and secret checks before deployment.', category: zh ? '部署' : 'Deployment', sourcePath: 'deployment-guides/how-to/security-best-practices.mdx', content: zh ? chineseDocs['production-security'] : deploymentSource },
		];
	});

	const filteredDocs = $derived.by(() => {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle) return docs;
		return docs.filter((doc) => `${doc.title}\n${doc.description}\n${doc.category}\n${doc.content}`.toLocaleLowerCase().includes(needle));
	});
	const selectedDoc = $derived(docs.find((doc) => doc.slug === selectedSlug) ?? docs[0]);
	const renderedDocument = $derived(renderDocument(selectedDoc));

	function renderDocument(doc: DocEntry): string {
		const source = normalizeMdxDocument(doc.content, doc.sourcePath);
		const html = applyMediaLoadingHints(markdown.parse(source, { async: false }) as string);
		return DOMPurify.sanitize(html, {
			ADD_ATTR: ['target', 'rel'],
			FORBID_TAGS: ['style', 'iframe', 'object', 'embed'],
			FORBID_ATTR: ['style'],
		});
	}

	function attachSanitizedHtml(html: string): (node: HTMLElement) => void {
		return (node) => { node.innerHTML = html; };
	}
</script>

<section class="page-shell">
	<header class="hero">
		<div>
			<p class="eyebrow">{getAppName()}</p>
			<h1>{i18n.t('elygate.docsHub')}</h1>
			<p>{i18n.t('elygate.docsHubHint')}</p>
		</div>
		<div class="header-actions">
			<a class="primary" href="https://docs.getbifrost.ai" target="_blank" rel="noopener noreferrer">{i18n.t('elygate.fullDocumentation')} ↗</a>
			<a href="#/mcp-usage-guide">{i18n.t('elygate.mcpUsageGuide')}</a>
		</div>
	</header>

	<a class="deployment-card" href="#/security-config">
		<span>✓</span>
		<div><strong>{i18n.locale === 'zh-CN' ? '生产部署帮助' : 'Production deployment help'}</strong><p>{i18n.locale === 'zh-CN' ? '检查管理员认证、密钥、代理、可观测性与安全设置。' : 'Review administrator auth, secrets, proxies, observability, and security settings.'}</p></div>
		<b>→</b>
	</a>

	<div class="browser-shell">
		<aside class="doc-nav">
			<label>
				<span>{i18n.locale === 'zh-CN' ? '搜索文档' : 'Search docs'}</span>
				<input bind:value={query} type="search" placeholder={i18n.locale === 'zh-CN' ? '标题、内容或分类…' : 'Title, content, or category…'} />
			</label>
			<nav aria-label={i18n.locale === 'zh-CN' ? '内置文档' : 'Built-in documentation'}>
				{#each filteredDocs as doc (doc.slug)}
					<button class:active={selectedDoc.slug === doc.slug} type="button" onclick={() => (selectedSlug = doc.slug)}>
						<small>{doc.category}</small><strong>{doc.title}</strong><span>{doc.description}</span>
					</button>
				{:else}
					<p class="empty">{i18n.locale === 'zh-CN' ? '没有匹配的文档。' : 'No matching documentation.'}</p>
				{/each}
			</nav>
		</aside>

		<article class="doc-reader">
			<header><small>{selectedDoc.category}</small><h2>{selectedDoc.title}</h2><p>{selectedDoc.description}</p></header>
			<div class="article-body" {@attach attachSanitizedHtml(renderedDocument)}></div>
		</article>
	</div>
</section>

<style>
	.page-shell{max-width:1440px;margin:0 auto;padding:1.5rem}.hero{align-items:flex-end;display:flex;gap:1rem;justify-content:space-between;margin-bottom:1rem}.eyebrow{color:var(--primary);font-size:.75rem;font-weight:700;letter-spacing:.12em;margin:0 0 .45rem;text-transform:uppercase}h1{font-size:clamp(1.6rem,4vw,2.45rem);margin:0}.hero p:not(.eyebrow){color:var(--muted-foreground);margin:.65rem 0 0;max-width:680px}.header-actions{display:flex;flex-wrap:wrap;gap:.6rem}.header-actions a{border:1px solid var(--border);border-radius:.55rem;color:var(--foreground);font-weight:650;padding:.55rem .75rem;text-decoration:none}.header-actions a.primary{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground)}.deployment-card{align-items:center;background:linear-gradient(135deg,color-mix(in oklch,var(--primary) 10%,var(--card)),var(--card));border:1px solid color-mix(in oklch,var(--primary) 38%,var(--border));border-radius:.85rem;color:var(--foreground);display:flex;gap:.85rem;margin-bottom:1rem;padding:.8rem 1rem;text-decoration:none}.deployment-card>span{align-items:center;background:var(--primary);border-radius:999px;color:var(--primary-foreground);display:flex;font-weight:800;height:2rem;justify-content:center;width:2rem}.deployment-card div{flex:1}.deployment-card p{color:var(--muted-foreground);font-size:.82rem;margin:.18rem 0 0}.deployment-card b{color:var(--primary)}.browser-shell{background:var(--card);border:1px solid var(--border);border-radius:1rem;display:grid;grid-template-columns:19rem minmax(0,1fr);min-height:70vh;overflow:hidden}.doc-nav{border-right:1px solid var(--border);padding:.85rem}.doc-nav label{display:grid;gap:.35rem}.doc-nav label span{color:var(--muted-foreground);font-size:.72rem;font-weight:700;text-transform:uppercase}.doc-nav input{background:var(--background);border:1px solid var(--border);border-radius:.55rem;color:var(--foreground);padding:.62rem .7rem;width:100%}.doc-nav nav{display:grid;gap:.35rem;margin-top:.75rem;max-height:calc(70vh - 5rem);overflow:auto}.doc-nav button{background:transparent;border:1px solid transparent;border-radius:.65rem;color:var(--foreground);cursor:pointer;display:grid;gap:.15rem;padding:.65rem;text-align:left}.doc-nav button:hover,.doc-nav button.active{background:var(--accent);border-color:var(--border)}.doc-nav button small,.doc-reader header small{color:var(--primary);font-size:.68rem;font-weight:750;text-transform:uppercase}.doc-nav button span{color:var(--muted-foreground);font-size:.75rem;line-height:1.35}.empty{color:var(--muted-foreground);font-size:.8rem;padding:.6rem}.doc-reader{min-width:0;padding:clamp(1rem,3vw,2.25rem)}.doc-reader>header{border-bottom:1px solid var(--border);margin-bottom:1.5rem;padding-bottom:1rem}.doc-reader h2{font-size:1.75rem;margin:.25rem 0}.doc-reader header p{color:var(--muted-foreground);margin:.35rem 0 0}.article-body{color:var(--foreground);line-height:1.7;max-width:860px}.article-body :global(h1),.article-body :global(h2),.article-body :global(h3){line-height:1.25;margin:1.7em 0 .65em}.article-body :global(h1){font-size:1.7rem}.article-body :global(h2){border-bottom:1px solid var(--border);font-size:1.35rem;padding-bottom:.35rem}.article-body :global(h3){font-size:1.08rem}.article-body :global(a){color:var(--primary)}.article-body :global(pre){background:#0d1117;border:1px solid #30363d;border-radius:.7rem;color:#e6edf3;overflow:auto;padding:1rem}.article-body :global(code){font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em}.article-body :global(:not(pre)>code){background:var(--muted);border-radius:.3rem;padding:.12rem .3rem}.article-body :global(table){border-collapse:collapse;display:block;max-width:100%;overflow:auto}.article-body :global(th),.article-body :global(td){border:1px solid var(--border);padding:.45rem .6rem;text-align:left}.article-body :global(blockquote){border-left:3px solid var(--primary);color:var(--muted-foreground);margin-left:0;padding-left:1rem}.article-body :global(img){border:1px solid var(--border);border-radius:.6rem;max-width:100%}.article-body :global(.hljs-keyword),.article-body :global(.hljs-selector-tag){color:#ff7b72}.article-body :global(.hljs-string),.article-body :global(.hljs-attr){color:#a5d6ff}.article-body :global(.hljs-number),.article-body :global(.hljs-literal){color:#79c0ff}@media(max-width:860px){.hero{align-items:flex-start;flex-direction:column}.browser-shell{grid-template-columns:1fr}.doc-nav{border-bottom:1px solid var(--border);border-right:0}.doc-nav nav{grid-template-columns:repeat(2,minmax(0,1fr));max-height:18rem}}@media(max-width:560px){.page-shell{padding:.85rem}.doc-nav nav{grid-template-columns:1fr}.doc-reader{padding:1rem}.deployment-card{align-items:flex-start}.deployment-card b{display:none}}
</style>
