# OpenClaw Chat App 配置指南

## 📱 打包成 App 的前后端配置说明

### 架构说明

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Chat App                      │
│                      (前端 - Capacitor)                   │
└─────────────────────────────────────────────────────────┘
                            ↓
                    HTTP/SSE/WebSocket
                            ↓
┌─────────────────────────────────────────────────────────┐
│               后端服务器 (Node.js + Express)              │
│                 处理认证、会话、消息                      │
└─────────────────────────────────────────────────────────┘
```

---

## 📋 配置文件说明

### 1. 环境变量配置

#### 开发环境：`.env.development`
```bash
# 本地开发服务器
VITE_API_BASE_URL=http://localhost:3210
```

#### 生产环境：`.env.production`
```bash
# 生产服务器地址（重要！打包前请修改）
VITE_API_BASE_URL=https://your-server.com

# 或使用 IP（仅用于测试）
# VITE_API_BASE_URL=http://192.168.33.30:3210
```

---

### 2. 用户配置（App 内设置）

用户可以在 App 的"设置"页面配置服务器地址：

1. 打开 App
2. 点击右上角设置按钮
3. 修改"服务器地址"
4. 保存并重新连接

**配置存储位置：** `localStorage` -> `clawapp-config`

---

### 3. Capacitor 配置

文件：`capacitor.config.ts`

```typescript
{
  appId: 'com.openclaw.chat',
  appName: 'OpenClaw Chat',
  webDir: 'dist',
  server: {
    androidScheme: 'https',  // Android 上使用 HTTPS
  }
}
```

---

## 🔄 配置优先级

```
1. 用户配置（localStorage）       ← 最高优先级
   ↓ 未配置
2. 环境变量（.env.production）
   ↓ 未配置
3. Capacitor 默认值
   ↓ 未配置
4. window.location.origin       ← Web 环境默认值
```

---

## 🚀 打包步骤

### 步骤 1：配置生产环境服务器地址

编辑 `.env.production`：
```bash
VITE_API_BASE_URL=https://your-actual-server.com
```

### 步骤 2：构建项目

```bash
npm run build
```

### 步骤 3：同步到 Capacitor

```bash
# 如果还没有初始化 Capacitor
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android @capacitor/ios
npx cap init

# 添加平台（如果还没有）
npx cap add android
npx cap add ios

# 同步构建产物
npx cap sync
```

### 步骤 4：打开项目打包

```bash
# Android
npx cap open android

# iOS
npx cap open ios
```

### 步骤 5：在 Android Studio / Xcode 中打包

- **Android Studio**: Build -> Build Bundle(s) / APK(s)
- **Xcode**: Product -> Archive

---

## 🔧 开发调试

### 本地开发（连接本地后端）

```bash
# 启动后端服务器
cd server
node index.js

# 启动前端开发服务器
cd h5
npm run dev
```

### Capacitor 开发（连接本地后端）

1. 确保 Android 设备/模拟器能访问电脑的 IP
2. 在 App 设置中配置服务器地址：`http://192.168.x.x:3210`
3. 或修改 `.env.development`：
   ```bash
   VITE_API_BASE_URL=http://10.0.2.2:3210  # Android 模拟器
   ```

---

## ⚠️ 注意事项

### 1. HTTPS vs HTTP

**生产环境：** 必须使用 HTTPS
- Android 9+ 默认不允许 HTTP
- iOS 强制要求 HTTPS

**开发环境：** 可以使用 HTTP
- 已配置 `android:usesCleartextTraffic="true"`
- 已配置 `network_security_config.xml`

### 2. CORS 配置

确保后端服务器允许来自 App 的请求：

```javascript
// server/index.js
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  next()
})
```

### 3. 环境变量区分

- `.env.development` - 开发环境
- `.env.production` - 生产环境
- 不要把 `.env.production` 提交到版本控制（包含服务器地址）

---

## 📱 App 发布检查清单

打包前确认：

- [ ] `.env.production` 中的服务器地址正确
- [ ] 后端服务器已部署并可访问
- [ ] HTTPS 证书有效（生产环境）
- [ ] 测试登录/注册功能
- [ ] 测试消息发送/接收
- [ ] 测试会话切换
- [ ] 测试设置页面修改服务器地址
- [ ] 测试离线重连

---

## 🐛 常见问题

### Q: App 打开后无法连接服务器

**A:** 检查以下几点：
1. 设置页面中的服务器地址是否正确
2. 后端服务器是否正在运行
3. 网络连接是否正常
4. 防火墙是否阻止了连接

### Q: Android 提示 "Cleartext traffic permitted"

**A:** 这是正常的，已配置允许 HTTP（仅用于开发）

### Q: 如何更新 App 内的服务器地址？

**A:** 用户可以在 App 内的设置页面修改，无需重新打包

---

## 📞 技术支持

如有问题，请查看：
- 项目文档：README.md
- 问题反馈：GitHub Issues
