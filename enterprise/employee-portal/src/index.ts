import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = createApp(config).listen({ hostname: '0.0.0.0', port: config.port });

console.log(`Elygate 员工门户已监听 ${app.server?.hostname}:${app.server?.port}`);
