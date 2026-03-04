# Elygate Single Binary Build Guide | Elygate 单二进制构建指南

[English](#english) | [中文](#中文)

---

<a name="english"></a>

## English

### 📦 Single Binary Build

Yes! Elygate can build a single binary file that includes both the Gateway API and Web UI, similar to New API.

---

### 🚀 How It Works

New API (written in Go) uses Go's `embed` package to embed static files into the binary. Elygate (using Bun) achieves the same result using Bun's built-in bundler with `--compile` flag.

**Key Points:**
1. Build Web UI first → generates static files in `apps/web/build`
2. Gateway serves these files using `@elysiajs/static` plugin
3. Bun's `--compile` embeds everything into a single executable

---

### 🔧 Local Build

#### Quick Build (Auto-detect Platform)
```bash
bun run build:binary
```

#### Build for Specific Platform
```bash
# Linux x64
bun run build:binary:linux-x64

# Linux ARM64
bun run build:binary:linux-arm64

# macOS Intel
bun run build:binary:darwin-x64

# macOS Apple Silicon
bun run build:binary:darwin-arm64

# Windows
bun run build:binary:windows
```

#### Manual Build
```bash
# Step 1: Build Web UI
cd apps/web
bun run build
cd ../..

# Step 2: Build Binary
bun build apps/gateway/src/index.ts \
  --compile \
  --outfile elygate \
  --target=bun-linux-x64 \
  --minify
```

---

### 🤖 CI/CD Build

Elygate includes automated binary builds via GitHub Actions.

#### Workflows

**1. Build Binary (`build-binary.yml`)**
- Triggers: Push to main branch, manual dispatch
- Builds binaries for all platforms
- Uploads artifacts

**2. Release (`release.yml`)**
- Triggers: Git tags (v*), manual dispatch
- Builds binaries for all platforms
- Creates GitHub Release
- Attaches binaries to release

#### Trigger a Release

**Option 1: Git Tag**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**Option 2: Manual Dispatch**
1. Go to Actions → Release Binary
2. Click "Run workflow"
3. Enter version (e.g., v1.0.0)
4. Click "Run workflow"

#### Release Artifacts

| Platform | Architecture | File |
|----------|--------------|------|
| Linux | x64 | `elygate-bun-linux-x64` |
| Linux | ARM64 | `elygate-bun-linux-arm64` |
| macOS | x64 | `elygate-darwin-x64` |
| macOS | ARM64 | `elygate-darwin-arm64` |
| Windows | x64 | `elygate-bun-windows-x64.exe` |

---

### 📊 Binary Size

| Platform | Size |
|----------|------|
| Linux x64 | ~80-100 MB |
| Linux ARM64 | ~80-100 MB |
| macOS | ~80-100 MB |
| Windows | ~90-110 MB |

*Note: Binary size includes Bun runtime and all dependencies.*

---

### 🚀 Deployment

#### Simple Deployment
```bash
# Download binary
wget https://github.com/zuohuadong/elygate/releases/latest/download/elygate-bun-linux-x64

# Make executable
chmod +x elygate-bun-linux-x64

# Run
./elygate-bun-linux-x64
```

#### With Environment Variables
```bash
# Create .env file
cat > .env << EOF
DATABASE_URL=postgresql://user:pass@localhost:5432/elygate
GATEWAY_URL=http://localhost:3000
WEB_URL=http://localhost:3000
EOF

# Run
./elygate-bun-linux-x64
```

#### Systemd Service
```bash
# /etc/systemd/system/elygate.service
[Unit]
Description=Elygate API Gateway
After=network.target postgresql.service

[Service]
Type=simple
User=elygate
WorkingDirectory=/opt/elygate
ExecStart=/opt/elygate/elygate-bun-linux-x64
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl enable elygate
sudo systemctl start elygate
```

---

<a name="中文"></a>

## 中文

### 📦 单二进制构建

是的！Elygate 可以构建包含 Gateway API 和 Web UI 的单个二进制文件，类似于 New API。

---

### 🚀 工作原理

New API（使用 Go 编写）使用 Go 的 `embed` 包将静态文件嵌入二进制文件。Elygate（使用 Bun）通过 Bun 的内置打包器和 `--compile` 标志实现相同效果。

**关键点：**
1. 先构建 Web UI → 在 `apps/web/build` 生成静态文件
2. Gateway 使用 `@elysiajs/static` 插件提供这些文件
3. Bun 的 `--compile` 将所有内容嵌入单个可执行文件

---

### 🔧 本地构建

#### 快速构建（自动检测平台）
```bash
bun run build:binary
```

#### 为特定平台构建
```bash
# Linux x64
bun run build:binary:linux-x64

# Linux ARM64
bun run build:binary:linux-arm64

# macOS Intel
bun run build:binary:darwin-x64

# macOS Apple Silicon
bun run build:binary:darwin-arm64

# Windows
bun run build:binary:windows
```

#### 手动构建
```bash
# 步骤 1：构建 Web UI
cd apps/web
bun run build
cd ../..

# 步骤 2：构建二进制文件
bun build apps/gateway/src/index.ts \
  --compile \
  --outfile elygate \
  --target=bun-linux-x64 \
  --minify
```

---

### 🤖 CI/CD 构建

Elygate 通过 GitHub Actions 实现自动化二进制构建。

#### 工作流

**1. 构建二进制文件 (`build-binary.yml`)**
- 触发：推送到 main 分支、手动触发
- 为所有平台构建二进制文件
- 上传构建产物

**2. 发布 (`release.yml`)**
- 触发：Git 标签 (v*)、手动触发
- 为所有平台构建二进制文件
- 创建 GitHub Release
- 附加二进制文件到发布

#### 触发发布

**方式 1：Git 标签**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**方式 2：手动触发**
1. 进入 Actions → Release Binary
2. 点击 "Run workflow"
3. 输入版本号（如 v1.0.0）
4. 点击 "Run workflow"

#### 发布产物

| 平台 | 架构 | 文件 |
|------|------|------|
| Linux | x64 | `elygate-bun-linux-x64` |
| Linux | ARM64 | `elygate-bun-linux-arm64` |
| macOS | x64 | `elygate-darwin-x64` |
| macOS | ARM64 | `elygate-darwin-arm64` |
| Windows | x64 | `elygate-bun-windows-x64.exe` |

---

### 📊 二进制文件大小

| 平台 | 大小 |
|------|------|
| Linux x64 | ~80-100 MB |
| Linux ARM64 | ~80-100 MB |
| macOS | ~80-100 MB |
| Windows | ~90-110 MB |

*注意：二进制文件大小包含 Bun 运行时和所有依赖。*

---

### 🚀 部署

#### 简单部署
```bash
# 下载二进制文件
wget https://github.com/zuohuadong/elygate/releases/latest/download/elygate-bun-linux-x64

# 添加执行权限
chmod +x elygate-bun-linux-x64

# 运行
./elygate-bun-linux-x64
```

#### 使用环境变量
```bash
# 创建 .env 文件
cat > .env << EOF
DATABASE_URL=postgresql://user:pass@localhost:5432/elygate
GATEWAY_URL=http://localhost:3000
WEB_URL=http://localhost:3000
EOF

# 运行
./elygate-bun-linux-x64
```

#### Systemd 服务
```bash
# /etc/systemd/system/elygate.service
[Unit]
Description=Elygate API Gateway
After=network.target postgresql.service

[Service]
Type=simple
User=elygate
WorkingDirectory=/opt/elygate
ExecStart=/opt/elygate/elygate-bun-linux-x64
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# 启用并启动
sudo systemctl enable elygate
sudo systemctl start elygate
```

---

### 🎉 Summary | 总结

**English**:
Elygate supports single binary builds that include both API and UI, just like New API! Use `bun run build:binary` for local builds or push a git tag to trigger CI builds.

**中文**:
Elygate 支持构建包含 API 和 UI 的单个二进制文件，就像 New API 一样！使用 `bun run build:binary` 进行本地构建，或推送 git 标签触发 CI 构建。
