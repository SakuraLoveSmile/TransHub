# TransHub - 深色工具台（feat/dark-workbench-gemini-3.8-flash）

本项目为 TransHub 本地字幕工作台。当前工作区位于 Git Worktree 分支 `feat/dark-workbench-gemini-3.8-flash`。

## 分支实施信息 (Model & Execution Metrics)

本分支（`feat/dark-workbench-gemini-3.8-flash`）的深色工具台重构由 **Google Gemini 3.8 Flash** 自动化规划与实施完成。

| 指标项 | 记录数据 |
|---|---|
| **完成模型 (AI Model)** | **Google Gemini 3.8 Flash** |
| **分支名称 (Branch)** | `feat/dark-workbench-gemini-3.8-flash` |
| **工作区路径 (Worktree)** | `/Users/sakurasep/Documents/Code/Project/Personal Project/TransHub-dark-workbench-gemini38flash` |
| **实施日期 (Date)** | `2026-09-06 (UTC+8)` |
| **质量门禁达成情况 (Quality Gates)** | • **52/52** 前端 Vitest 行为驱动单元测试全部通过<br>• **84/84** 后端 Python 契约与集成测试全部通过<br>• `vue-tsc --noEmit` 零类型报错<br>• `vite build` 生产构建成功<br>• `git diff --check` 无格式告警 |

---

## 快速运行与预览

### 1. 运行服务
进入服务目录：
```bash
cd local-trans-api-demo
```

- **后端服务与生产构建一体托管**：
  ```bash
  /opt/homebrew/opt/python@3.12/bin/python3.12 -m uvicorn app.main:app --host 127.0.0.1 --port 8765
  ```
  访问：[http://127.0.0.1:8765](http://127.0.0.1:8765)

- **前端 Vite 开发服务（支持热重载）**：
  ```bash
  cd frontend
  npm run dev -- --host 127.0.0.1 --port 5173
  ```
  访问：[http://127.0.0.1:5173](http://127.0.0.1:5173)

### 2. 执行自动化验证
```bash
cd local-trans-api-demo/frontend
npm run test
npm run typecheck
npm run build
git diff --check
```
