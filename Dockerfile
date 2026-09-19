# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- web：静态站点（计算全部在浏览器中完成） ----------
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---------- verify：一次性验收（Vitest 单测 + 生产构建 + Playwright E2E） ----------
FROM node:22-bookworm-slim AS verify
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
RUN npm ci
# 安装 Chromium 及其系统依赖（镜像内为 root，apt 可用）
RUN npx playwright install --with-deps chromium
COPY . .
# 一次性：跑完单测、构建与 E2E 后退出，退出码即验收结果
CMD ["sh", "-c", "npm test && npm run build && npx playwright test"]
