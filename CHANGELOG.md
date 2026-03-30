# 更新日志

所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-03-30

### Added
- 会话名称可随时修改，不再受唯一性限制
- 服务器自动生成会话标识符（UUID），避免冲突
- 友好的默认会话名称"新会话"

### Changed
- 会话创建流程优化，使用 UUID 作为唯一标识符
- 会话名称不再作为标识符的一部分
- 前端不再生成 sessionKey，改为后端自动生成

### Fixed
- 修复用户修改会话名称可能导致冲突的问题
- 修复创建同名会话失败的问题

### Technical
- 后端新增 UUID 生成工具函数（server/utils/uuid.js）
- 后端会话创建 API 支持 gatewaySessionId 为 null 时自动生成
- 前端 API 客户端更新，传递 null 让后端生成
- 前端会话选择器优化，删除随机名称生成逻辑

## [1.0.0] - 2026-03-27

### Added
- 初始版本发布
- 用户认证系统（JWT + Access Token）
- 多租户会话隔离
- 实时流式聊天
- Markdown 渲染
- 会话管理功能
- 登录用户会话云端同步
- 公开链接访问（Token）
