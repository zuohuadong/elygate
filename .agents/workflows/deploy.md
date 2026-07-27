---
description: Deploy elygate to production server (5.78.65.161)
---

# Deploy Elygate

Deploy the elygate project (gateway + web) to the production server.

**Server**: `elygate` (root@5.78.65.161)
**Deploy dir**: `/opt/elygate`

## Steps

// turbo-all

1. Install dependencies locally

```bash
cd /Users/zhd/gcadlog/workerspace/elygate && bun install
```

2. Build the web app locally to verify no errors

```bash
cd /Users/zhd/gcadlog/workerspace/elygate && bun run build
```

3. Sync project files to server via rsync (excludes node_modules, .git, logs, .env)

```bash
cd /Users/zhd/gcadlog/workerspace/elygate && rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'bun.lock' --exclude '*.log' --exclude '.env' ./ elygate:/opt/elygate/
```

4. Install dependencies on server, build the web app, and restart BOTH services (gateway on port 3000 + web SSR on port 3001)

```bash
ssh elygate "cd /opt/elygate && source ~/.bash_profile && bun install && bun run build && systemctl restart elygate elygate-web && sleep 3 && systemctl status elygate elygate-web | head -30"
```

5. Verify the deployment by checking both services respond correctly

```bash
ssh elygate "echo 'Gateway (3000):' && curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login && echo ''; echo 'Web SSR (3001):' && curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/login && echo ''; curl -s http://localhost:3000/health | head -5"
```
