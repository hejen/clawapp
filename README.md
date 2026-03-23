# OpenClaw Chat

基于 [ClawApp](https://github.com/qingchencloud/clawapp) 二次开发的 OpenClaw AI 聊天客户端，支持用户认证和多租户会话隔离。

## 特性

- 💬 实时流式聊天
- 🔐 用户认证系统（JWT + Access Token）
- 👥 多租户会话隔离
- 📝 Markdown 渲染
- 🔄 会话管理
- 💾 登录用户会话云端同步
- 🔗 公开链接访问（Token）

## 快速开始

### 前置要求

- Node.js 18+
- OpenClaw Gateway 运行中（端口 18789）

### 安装

```bash
# 安装依赖
npm run install:all

# 构建前端
npm run build:h5
```

### 配置

```bash
cd server
cp .env.example .env
```

编辑 `.env` 文件，配置以下项：

```bash
# OpenClaw Gateway Token
OPENCLAW_GATEWAY_TOKEN=your-gateway-token

# JWT 密钥（至少 32 字符）
JWT_SECRET=your-very-long-secret-key
```

### 初始化数据库

```bash
node server/init-db.js
```

### 启动服务

```bash
npm start
```

访问 `http://localhost:3210`

## 访问方式

### 账号登录

1. 访问 `http://localhost:3210`
2. 点击"注册"创建账号
3. 使用用户名密码登录

### 公开链接（Token）

1. 登录后通过 API 创建访问 Token
2. 分享链接：`http://localhost:3210/?t=TOKEN`

## API 文档

### 认证

- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息

### Token 管理

- `POST /api/tokens` - 创建访问 Token
- `GET /api/tokens` - 列出 Token
- `DELETE /api/tokens/:id` - 删除 Token

### 会话管理

- `GET /api/sessions` - 获取会话列表
- `POST /api/sessions` - 创建会话
- `DELETE /api/sessions/:id` - 删除会话
- `PUT /api/sessions/:id` - 更新会话标题

## 数据库

默认使用 SQLite，数据库文件：`server/data/chat.db`

### 表结构

- `users` - 用户表
- `access_tokens` - 访问令牌表
- `user_sessions` - 用户会话表

## 开发

```bash
# 安装依赖
npm run install:all

# 前端开发（热更新）
npm run dev:h5

# 后端开发
npm run dev:server
```

## License

MIT

## 基于

- [ClawApp](https://github.com/qingchencloud/clawapp) - H5 移动端聊天客户端
- [OpenClaw](https://github.com/openclaw/openclaw) - AI 智能体平台
