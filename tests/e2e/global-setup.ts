/**
 * Single global setup for all E2E tests.
 * 1. Builds test plugin (plugins) and copies to /tmp.
 * 2. Builds and starts MCP test servers (HTTP/SSE on 3001, STDIO test-tools-server).
 * 3. Creates a run-scoped TestClient001_* MCP client and waits for it to connect.
 * 4. Sends a POST /v1/responses request to validate the proxy with MCP.
 * Returns a teardown function that deletes only this run's recorded client ID and stops MCP servers.
 */
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import * as http from 'http'
import * as net from 'net'
import * as os from 'os'
import { join, resolve } from 'path'
import { setTimeout } from 'timers/promises'

const TEST_MCP_CLIENT_PREFIX = 'TestClient001'
const TEST_MCP_CLIENT_RUN_ID = `${Date.now()}_${process.pid}_${randomUUID().replace(/-/g, '')}`
const TEST_MCP_CLIENT_NAME = `${TEST_MCP_CLIENT_PREFIX}_${TEST_MCP_CLIENT_RUN_ID}`
const BIFROST_BASE_URL = process.env.BIFROST_BASE_URL ?? 'http://localhost:8080'
const MOCK_PROVIDER_BASE_URL = process.env.BIFROST_E2E_MOCK_PROVIDER_BASE_URL ?? 'http://127.0.0.1:65535'
const MOCK_PROVIDER_KEY = process.env.BIFROST_E2E_MOCK_PROVIDER_KEY ?? 'mock-key'
const TEST_ANTHROPIC_KEY_NAME = 'bifrost-e2e-anthropic'

const REPO_ROOT = resolve(__dirname, '../..')
const TEST_PLUGIN_PATH = join(REPO_ROOT, 'tmp', 'bifrost-test-plugin.so')

const MCP_SERVERS: ChildProcess[] = []
const isWindows = os.platform() === 'win32'
const npmCommand = isWindows ? 'npm.cmd' : 'npm'
const goCommand = isWindows ? 'go.exe' : 'go'
const makeCommand = isWindows ? 'make.exe' : 'make'
const httpServerBinaryName = isWindows ? 'http-server.exe' : 'http-server'
const httpServerExec = isWindows ? 'http-server.exe' : './http-server'

interface BifrostFixtureState {
  mcpClientId?: string
  anthropicProviderCreated: boolean
  anthropicKeyId?: string
}

function createBifrostFixtureState(): BifrostFixtureState {
  return { anthropicProviderCreated: false }
}

function runCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

async function checkServerReady(port: number, maxAttempts = 15): Promise<boolean> {
  const hosts = ['127.0.0.1', 'localhost', '[::1]']
  const paths = ['/mcp', '/']

  const tryInitialize = async (url: string): Promise<boolean> =>
    new Promise((res) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (response) => {
          response.on('data', () => {})
          response.on('end', () => res(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300)))
        }
      )
      req.on('error', () => res(false))
      req.setTimeout(1000, () => {
        req.destroy()
        res(false)
      })
      req.write(body)
      req.end()
    })

  for (let i = 0; i < maxAttempts; i++) {
    for (const host of hosts) {
      for (const path of paths) {
        if (await tryInitialize(`http://${host}:${port}${path}`)) return true
      }
    }
    await setTimeout(1000)
  }
  return false
}

async function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const finish = (listening: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolvePort(listening)
    }
    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

interface HttpResult {
  statusCode: number
  body: string
}

function httpRequest(
  baseUrl: string,
  method: string,
  path: string,
  options: { body?: string; headers?: Record<string, string> } = {}
): Promise<HttpResult> {
  const u = new URL(baseUrl)
  const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80)
  const body = options.body ?? ''
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  if (body && !headers['Content-Length']) {
    headers['Content-Length'] = String(Buffer.byteLength(body))
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
      }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => {
      req.destroy()
      reject(new Error('request timeout'))
    })
    if (body) req.write(body)
    req.end()
  })
}

async function waitForBifrostAPI(baseUrl: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await httpRequest(baseUrl, 'GET', '/health')
      if (r.statusCode >= 200 && r.statusCode < 300) return
    } catch {
      // ignore
    }
    await setTimeout(1000)
  }
  throw new Error(`Bifrost API at ${baseUrl} did not become ready after ${maxAttempts} attempts`)
}

interface MCPClientItem {
  config: { name: string; client_id: string }
  state: string
}

async function getMCPClientById(baseUrl: string, clientId: string): Promise<MCPClientItem | undefined> {
  const clientsRes = await httpRequest(
    baseUrl,
    'GET',
    `/api/mcp/clients?server=${encodeURIComponent(clientId)}&limit=1`
  )
  if (clientsRes.statusCode !== 200) {
    throw new Error(`GET /api/mcp/clients failed: ${clientsRes.statusCode} ${clientsRes.body}`)
  }
  try {
    const parsed = JSON.parse(clientsRes.body) as { clients?: MCPClientItem[] } | MCPClientItem[]
    const clients = Array.isArray(parsed) ? parsed : (parsed.clients ?? [])
    return clients.find((client) => client.config?.client_id === clientId)
  } catch {
    throw new Error('Invalid JSON from GET /api/mcp/clients')
  }
}

async function deleteMCPClient(baseUrl: string, clientId: string): Promise<void> {
  const deleteRes = await httpRequest(baseUrl, 'DELETE', `/api/mcp/client/${encodeURIComponent(clientId)}`)
  if (deleteRes.statusCode !== 404 && (deleteRes.statusCode < 200 || deleteRes.statusCode >= 300)) {
    throw new Error(`DELETE /api/mcp/client/${clientId} failed: ${deleteRes.statusCode} ${deleteRes.body}`)
  }
}

async function createRunScopedMCPClient(baseUrl: string, state: BifrostFixtureState): Promise<void> {
  const requestedClientId = randomUUID()
  console.log(`Creating MCP client "${TEST_MCP_CLIENT_NAME}" via POST /api/mcp/client...`)
  const createBody = JSON.stringify({
    client_id: requestedClientId,
    name: TEST_MCP_CLIENT_NAME,
    is_code_mode_client: false,
    is_ping_available: false,
    connection_type: 'http',
    connection_string: { value: 'http://localhost:3001/', env_var: '', from_env: false },
    auth_type: 'none',
    tools_to_execute: ['*'],
    tools_to_auto_execute: ['*'],
  })
  const createRes = await httpRequest(baseUrl, 'POST', '/api/mcp/client', { body: createBody })
  if (createRes.statusCode < 200 || createRes.statusCode >= 300) {
    throw new Error(`POST /api/mcp/client failed: ${createRes.statusCode} ${createRes.body}`)
  }
  // The POST supplied this run-scoped ID and succeeded, so teardown owns this
  // exact client even if the subsequent connection-state polling fails.
  state.mcpClientId = requestedClientId
  console.log(`✓ Recorded POST-created run-scoped MCP client ID ${state.mcpClientId}`)

  for (let attempt = 0; attempt < 20; attempt++) {
    const client = await getMCPClientById(baseUrl, requestedClientId)
    if (client) {
      if (client.config.name !== TEST_MCP_CLIENT_NAME) {
        throw new Error(
          `MCP client ID ${requestedClientId} belongs to unexpected client "${client.config.name}" instead of "${TEST_MCP_CLIENT_NAME}"`
        )
      }
    }
    if (client?.state === 'connected') {
      console.log(`✓ MCP client "${TEST_MCP_CLIENT_NAME}" is connected`)
      return
    }
    await setTimeout(250)
  }

  throw new Error(`MCP client "${TEST_MCP_CLIENT_NAME}" did not reach connected state after create`)
}

interface ProviderItem {
  name: string
}

interface ProviderKeyItem {
  id: string
  name: string
  enabled?: boolean
}

async function ensureMockAnthropicProviderAndKey(baseUrl: string, state: BifrostFixtureState): Promise<void> {
  const providersRes = await httpRequest(baseUrl, 'GET', '/api/providers')
  if (providersRes.statusCode !== 200) {
    throw new Error(`GET /api/providers failed: ${providersRes.statusCode} ${providersRes.body}`)
  }
  const parsedProviders = JSON.parse(providersRes.body) as { providers?: ProviderItem[] }
  const hasAnthropic = (parsedProviders.providers ?? []).some((provider) => provider.name === 'anthropic')

  if (!hasAnthropic) {
    const createProviderRes = await httpRequest(baseUrl, 'POST', '/api/providers', {
      body: JSON.stringify({
        provider: 'anthropic',
        network_config: {
          base_url: MOCK_PROVIDER_BASE_URL,
          default_request_timeout_in_seconds: 2,
          max_retries: 0,
          retry_backoff_initial: 0,
          retry_backoff_max: 0,
          allow_private_network: true,
        },
      }),
    })
    if (createProviderRes.statusCode < 200 || createProviderRes.statusCode >= 300) {
      throw new Error(`POST /api/providers failed: ${createProviderRes.statusCode} ${createProviderRes.body}`)
    }
    state.anthropicProviderCreated = true
    console.log('✓ Created mock Anthropic provider for serial E2E tests')
  }

  const keysRes = await httpRequest(baseUrl, 'GET', '/api/providers/anthropic/keys')
  if (keysRes.statusCode !== 200) {
    throw new Error(`GET /api/providers/anthropic/keys failed: ${keysRes.statusCode} ${keysRes.body}`)
  }
  const parsedKeys = JSON.parse(keysRes.body) as { keys?: ProviderKeyItem[] }
  if ((parsedKeys.keys ?? []).some((key) => key.enabled !== false)) return

  const createKeyRes = await httpRequest(baseUrl, 'POST', '/api/providers/anthropic/keys', {
    body: JSON.stringify({
      name: TEST_ANTHROPIC_KEY_NAME,
      value: { value: MOCK_PROVIDER_KEY, type: 'plain_text' },
      models: ['*'],
      blacklisted_models: [],
      weight: 1,
      enabled: true,
      use_for_batch_api: false,
    }),
  })
  if (createKeyRes.statusCode < 200 || createKeyRes.statusCode >= 300) {
    throw new Error(`POST /api/providers/anthropic/keys failed: ${createKeyRes.statusCode} ${createKeyRes.body}`)
  }
  const createdKey = JSON.parse(createKeyRes.body) as ProviderKeyItem
  if (!createdKey.id) {
    throw new Error('POST /api/providers/anthropic/keys returned no key id')
  }
  state.anthropicKeyId = createdKey.id
  console.log('✓ Created mock Anthropic provider key for serial E2E tests')
}

async function runPluginSetup(): Promise<void> {
  console.log('Setting up test plugin for E2E tests...')
  console.log('Rebuilding test plugin with the gateway-compatible E2E build flags...')
  runCommand(makeCommand, ['build-test-plugin'], { cwd: REPO_ROOT })
  if (!existsSync(TEST_PLUGIN_PATH)) {
    throw new Error(`Plugin build reported success but file not found at ${TEST_PLUGIN_PATH}`)
  }
  console.log(`✓ Test plugin ready at ${TEST_PLUGIN_PATH}`)
}

async function waitForPort(port: number, maxAttempts = 20): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (await isPortListening(port)) return true
    await setTimeout(250)
  }
  return false
}

interface TestServerOptions {
  label: string
  command: string
  cwd: string
  port: number
  ready: () => Promise<boolean>
}

async function startOrReuseTestServer(options: TestServerOptions): Promise<void> {
  if (await isPortListening(options.port)) {
    if (!(await options.ready())) {
      throw new Error(`Port ${options.port} is already in use by a service that is not the expected ${options.label}`)
    }
    console.log(`✓ Reusing ${options.label} already listening on port ${options.port}`)
    return
  }

  console.log(`Starting ${options.label} on port ${options.port}...`)
  const server = spawn(options.command, [], {
    cwd: options.cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverOutput = ''
  let spawnError: Error | undefined
  server.stdout?.on('data', (data) => {
    const output = data.toString()
    serverOutput += output
    console.log(`[${options.label}] ${output.trim()}`)
  })
  server.stderr?.on('data', (data) => {
    const output = data.toString()
    serverOutput += output
    console.error(`[${options.label} Error] ${output.trim()}`)
  })
  server.once('error', (error) => {
    spawnError = error
  })

  const ready = await options.ready()
  const exited = server.exitCode !== null || server.signalCode !== null
  if (!ready || exited || spawnError || !server.pid) {
    if (server.pid && !exited) {
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        server.kill('SIGTERM')
      }
    }
    const reason = spawnError?.message ?? (exited ? `process exited with code ${server.exitCode}` : 'readiness check failed')
    throw new Error(`${options.label} failed to start: ${reason}. Output: ${serverOutput || 'No output captured'}`)
  }

  server.unref()
  MCP_SERVERS.push(server)
  console.log(`✓ ${options.label} is ready on port ${options.port} (PID: ${server.pid})`)
}

async function runMCPSetup(): Promise<void> {
  console.log('Setting up MCP test servers...')

  const httpServerDir = join(REPO_ROOT, 'examples', 'mcps', 'http-no-ping-server')
  const httpServerBinary = join(httpServerDir, httpServerBinaryName)

  if (!existsSync(httpServerBinary)) {
    console.log('Building HTTP/SSE server...')
    runCommand(goCommand, ['build', '-o', httpServerBinaryName, 'main.go'], {
      cwd: httpServerDir,
      env: { ...process.env, CGO_ENABLED: '0' },
    })
  } else {
    console.log('✓ HTTP/SSE server binary already exists')
  }

  if (!existsSync(httpServerBinary)) {
    throw new Error(`HTTP server binary not found at ${httpServerBinary}`)
  }
  await startOrReuseTestServer({
    label: 'HTTP/SSE server',
    command: httpServerExec,
    cwd: httpServerDir,
    port: 3001,
    ready: () => checkServerReady(3001, 20),
  })

  const stdioServerDir = join(REPO_ROOT, 'examples', 'mcps', 'test-tools-server')
  const stdioServerDist = join(stdioServerDir, 'dist', 'index.js')
  if (!existsSync(stdioServerDist)) {
    console.log('Building STDIO server...')
    runCommand(npmCommand, ['install'], { cwd: stdioServerDir })
    runCommand(npmCommand, ['run', 'build'], { cwd: stdioServerDir })
  } else {
    console.log('✓ STDIO server already built')
  }

  // Build and start auth-demo-server on port 3002
  try {
    const authServerBinaryName = isWindows ? 'auth-demo-server.exe' : 'auth-demo-server'
    const authServerDir = join(REPO_ROOT, 'examples', 'mcps', 'auth-demo-server')
    const authServerBinary = join(authServerDir, authServerBinaryName)
    const authServerExec = isWindows ? authServerBinaryName : './auth-demo-server'

    if (!existsSync(authServerBinary)) {
      console.log('Building auth-demo-server...')
      runCommand(goCommand, ['build', '-o', authServerBinaryName, 'main.go'], {
        cwd: authServerDir,
        env: { ...process.env, CGO_ENABLED: '0' },
      })
    } else {
      console.log('✓ auth-demo-server binary already exists')
    }

    await startOrReuseTestServer({
      label: 'auth-demo-server',
      command: authServerExec,
      cwd: authServerDir,
      port: 3002,
      ready: () => waitForPort(3002),
    })
  } catch (err) {
    console.warn(`⚠️  Failed to start auth-demo-server (header auth tests may skip): ${(err as Error).message}`)
  }

  // Build and start oauth-demo-server on port 3003
  try {
    const oauthServerBinaryName = isWindows ? 'oauth-demo-server.exe' : 'oauth-demo-server'
    const oauthServerDir = join(REPO_ROOT, 'examples', 'mcps', 'oauth-demo-server')
    const oauthServerBinary = join(oauthServerDir, oauthServerBinaryName)
    const oauthServerExec = isWindows ? oauthServerBinaryName : './oauth-demo-server'

    if (!existsSync(oauthServerBinary)) {
      console.log('Building oauth-demo-server...')
      runCommand(goCommand, ['build', '-o', oauthServerBinaryName, 'main.go'], {
        cwd: oauthServerDir,
        env: { ...process.env, CGO_ENABLED: '0' },
      })
    } else {
      console.log('✓ oauth-demo-server binary already exists')
    }

    await startOrReuseTestServer({
      label: 'oauth-demo-server',
      command: oauthServerExec,
      cwd: oauthServerDir,
      port: 3003,
      ready: () => waitForPort(3003),
    })
  } catch (err) {
    console.warn(`⚠️  Failed to start oauth-demo-server (OAuth tests may fail): ${(err as Error).message}`)
  }

  console.log('✓ MCP servers ready')
  console.log('  - HTTP/SSE server: http://localhost:3001/')
  console.log('  - Auth demo server: http://localhost:3002/')
  console.log('  - OAuth demo server: http://localhost:3003/')
  console.log('  - STDIO server: test-tools-server/dist/index.js')
}

/**
 * Seed LLM logs by sending a few chat completion requests through Bifrost.
 * This ensures the Logs and Dashboard pages have data to display during tests.
 * Uses anthropic/claude-sonnet-4-5-20250929 by default; falls back gracefully.
 */
async function seedLLMLogs(baseUrl: string, count = 5): Promise<void> {
  console.log(`Seeding ${count} LLM log entries via ${baseUrl}/v1/chat/completions...`)
  const model = process.env.SEED_MODEL ?? 'openai/gpt-4o-mini'
  // Run seed calls in parallel batches of 5 for speed
  const batchSize = 5
  let successCount = 0
  for (let batch = 0; batch < count; batch += batchSize) {
    const batchEnd = Math.min(batch + batchSize, count)
    const promises = []
    for (let i = batch; i < batchEnd; i++) {
      const body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: `E2E seed message ${i + 1}: say hello in ${(i % 5) + 1} words` }],
        max_tokens: 30,
      })
      promises.push(
        httpRequest(baseUrl, 'POST', '/v1/chat/completions', { body })
          .then((res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              successCount++
            } else {
              console.warn(`  Seed call ${i + 1} returned ${res.statusCode}: ${res.body.slice(0, 120)}`)
            }
          })
          .catch((err) => {
            console.warn(`  Seed call ${i + 1} failed: ${err}`)
          })
      )
    }
    await Promise.all(promises)
  }
  if (successCount > 0) {
    console.log(`✓ Seeded ${successCount}/${count} LLM log entries`)
  } else {
    console.warn(`⚠️  No seed calls succeeded. LLM Logs tests may see empty state.`)
  }
}

async function runBifrostMCPAndResponsesSetup(state: BifrostFixtureState): Promise<void> {
  if (!process.env.BIFROST_BASE_URL) {
    console.log('Skipping Bifrost MCP client and /v1/responses (BIFROST_BASE_URL not set)')
    return
  }
  console.log(`Waiting for Bifrost API at ${BIFROST_BASE_URL}...`)
  await waitForBifrostAPI(BIFROST_BASE_URL)
  console.log(`✓ Bifrost API ready`)
  await ensureMockAnthropicProviderAndKey(BIFROST_BASE_URL, state)
  await createRunScopedMCPClient(BIFROST_BASE_URL, state)
  await seedLLMLogs(BIFROST_BASE_URL, 30)
}

async function runBifrostTeardown(state: BifrostFixtureState): Promise<void> {
  if (!process.env.BIFROST_BASE_URL) return

  const cleanupErrors: Error[] = []
  try {
    if (state.mcpClientId) {
      await deleteMCPClient(BIFROST_BASE_URL, state.mcpClientId)
      console.log(`✓ Deleted run-scoped MCP client "${TEST_MCP_CLIENT_NAME}" (${state.mcpClientId})`)
    }
  } catch (error: unknown) {
    cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
  }

  try {
    if (state.anthropicProviderCreated) {
      const deleteProviderRes = await httpRequest(BIFROST_BASE_URL, 'DELETE', '/api/providers/anthropic')
      if (deleteProviderRes.statusCode !== 404 && (deleteProviderRes.statusCode < 200 || deleteProviderRes.statusCode >= 300)) {
        throw new Error(`DELETE /api/providers/anthropic failed: ${deleteProviderRes.statusCode} ${deleteProviderRes.body}`)
      }
      console.log('✓ Removed E2E-created Anthropic provider')
    } else if (state.anthropicKeyId) {
      const deleteKeyRes = await httpRequest(
        BIFROST_BASE_URL,
        'DELETE',
        `/api/providers/anthropic/keys/${encodeURIComponent(state.anthropicKeyId)}`
      )
      if (deleteKeyRes.statusCode !== 404 && (deleteKeyRes.statusCode < 200 || deleteKeyRes.statusCode >= 300)) {
        throw new Error(`DELETE Anthropic E2E key failed: ${deleteKeyRes.statusCode} ${deleteKeyRes.body}`)
      }
      console.log('✓ Removed E2E-created Anthropic provider key')
    }
  } catch (error: unknown) {
    cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`Failed to clean up one or more Bifrost E2E fixtures: ${cleanupErrors.map((error) => error.message).join('; ')}`)
  }
}

function runMCPTeardown(): void {
  console.log('Tearing down MCP test servers...')
  MCP_SERVERS.forEach((server, index) => {
    try {
      if (server.pid && !server.killed) {
        try {
          process.kill(-server.pid, 'SIGTERM')
          console.log(`✓ Stopped MCP server ${index + 1} (PID: ${server.pid})`)
        } catch {
          server.kill('SIGTERM')
        }
      } else if (!server.killed) {
        server.kill('SIGTERM')
        console.log(`✓ Stopped MCP server ${index + 1}`)
      }
    } catch (error) {
      console.error(`Failed to stop MCP server ${index + 1}:`, error)
    }
  })
}

async function globalSetup(): Promise<() => Promise<void>> {
  const fixtureState = createBifrostFixtureState()
  await runPluginSetup()
  try {
    await runMCPSetup()
  } catch (error: unknown) {
    const err = error as Error
    console.error(`\n❌ Failed to setup MCP servers: ${err?.message || String(error)}`)
    console.error('\nTo setup manually:')
    console.error('  cd examples/mcps/http-no-ping-server && go build -o http-server main.go && ./http-server &')
    console.error('  cd examples/mcps/test-tools-server && npm install && npm run build')
    runMCPTeardown()
    throw error
  }
  try {
    await runBifrostMCPAndResponsesSetup(fixtureState)
  } catch (error: unknown) {
    const err = error as Error
    console.error(`\n❌ Bifrost MCP client / v1/responses setup failed: ${err?.message || String(error)}`)
    console.error(`   Ensure Bifrost is running at ${BIFROST_BASE_URL} and OPENAI_API_KEY is set for /v1/responses.`)
    try {
      await runBifrostTeardown(fixtureState)
    } catch (cleanupError: unknown) {
      console.error(`   Cleanup after failed setup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
    }
    runMCPTeardown()
    throw error
  }
  return async () => {
    try {
      await runBifrostTeardown(fixtureState)
    } finally {
      runMCPTeardown()
    }
  }
}

export default globalSetup
