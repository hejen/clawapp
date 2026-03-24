import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.openclaw.chat',
  appName: 'OpenClaw Chat',
  webDir: 'dist',
  bundledWebRuntime: false,

  // 服务器配置
  server: {
    // 在 Android 上允许 HTTP 请求（如果使用 HTTP 服务器）
    androidScheme: 'https',
    // 如果服务器使用自签名证书，需要设置为 true（仅用于开发）
    // cleartext: true,
    // 添加特定的域名到 cleartext
    // androidCleartextPermitted: true,
  },

  // iOS 配置
  ios: {
    // 如果需要配置 Info.plist 内容
    cordovaLinker: 'sourcemap',
  },

  // Android 配置
  android: {
    // 如果需要配置 AndroidManifest.xml 内容
  },
};

export default config;
