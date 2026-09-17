# 多用户云端服务

前端必须登录。Hono + Better Auth 负责会话和管理员账号操作，Drizzle/PostgreSQL 保存账号、画布、素材、生成记录及文件引用，AWS SDK v3 访问私有 S3。普通账号仅能访问自己的业务记录，管理员页面不提供查看用户作品的入口。AI 接口仍由浏览器直连，密钥按账号保存在当前设备；Agent 连接和历史仍属于个人本机。

## Docker 部署

1. 从仓库根目录复制 `.env.example` 为 `.env`，填写全部配置。
2. 创建私有 S3 桶并设置下述 CORS；endpoint 必须可同时由服务器和浏览器访问。
3. 执行 `docker compose up -d --build`。后端启动时先执行已提交的数据库迁移；数据库保存在 `canvas-database` 卷中。
4. 首次初始化管理员（交互输入密码，避免直接写入命令历史）：

```bash
read -r -p '管理员邮箱: ' ADMIN_EMAIL
read -r -s -p '管理员密码: ' ADMIN_PASSWORD
export ADMIN_EMAIL ADMIN_PASSWORD
docker compose exec -e ADMIN_EMAIL -e ADMIN_PASSWORD server npm run admin:create
unset ADMIN_EMAIL ADMIN_PASSWORD
```

打开 `APP_ORIGIN`，登录后在账号菜单管理用户。公开注册关闭；普通用户的创建、停用、恢复及密码重置由管理员完成。管理员重置密码或停用会撤销原会话；用户修改密码撤销其他会话。管理员 CLI 可用于额外创建维护账号，Web 管理页面只管理普通账号。

默认前端端口 3000；数据库与后端不直接暴露公网。生产环境在前端之前配置 HTTPS，`APP_ORIGIN` 必须与浏览器地址完全一致。Secure Cookie 随 HTTPS 启用，Cookie 为 HttpOnly，同源写请求校验 Origin。若在 Nginx 前增加反向代理，应只信任明确的代理地址并配置 real_ip，使 `X-Real-IP` 代表真实客户端；禁止让公网请求自行指定该头。会话固定 7 天，不滚动延期；同一 IP 每分钟最多 5 次登录请求。

## 环境变量

| 名称 | 含义 |
| --- | --- |
| `APP_ORIGIN` | 浏览器访问的完整站点 origin，例如 `https://canvas.example.com` |
| `POSTGRES_PASSWORD` | Compose 数据库密码；会嵌入连接 URL，特殊字符需相应 URL 编码，建议使用随机十六进制值 |
| `DATABASE_URL` | 非 Compose 运行时的 PostgreSQL 连接串；Compose 根据数据库配置生成 |
| `AUTH_SECRET` | 长随机认证密钥，例如 `openssl rand -hex 32` 生成，部署后稳定保存 |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | 已有 S3 兼容服务、签名 region 与私有桶 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 服务端凭据，需要桶内对象的读取、写入、复制和删除权限 |
| `S3_FORCE_PATH_STYLE` | `true` 使用路径式地址，默认 `false` |
| `MAX_FILE_BYTES` | 默认 `104857600`（100 MiB）；前端从后端读取并使用相同限制 |

缺少必要配置会启动失败。不要将服务端密钥放入 `VITE_` 环境变量或前端配置。S3 服务可达性与凭据权限在实际请求时验证。

## S3 浏览器 CORS

桶保持私有。将 AllowedOrigins 替换为实际 `APP_ORIGIN`；开发环境需另加开发 origin：

```json
[
  {
    "AllowedOrigins": ["https://canvas.example.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"]
  }
]
```

上传地址有效 15 分钟，先写暂存对象；完成接口核验实际大小、类型和 ETag，再复制到最终对象。完成操作幂等，旧上传地址只能改暂存对象。已签发地址在到期前仍有效，退出或停用不能立即撤回这些地址。数据库只存稳定 `storageKey`；预览经鉴权入口获得新的临时读取地址。失败上传保留浏览器文件，手动重试；不自动循环重试。

## 保存、冲突与隔离

`/api/projects`、`/api/assets`、`/api/generation-logs` 均强制服务端用户归属；图片和视频日志分别存表，通过 kind 选择。更新与删除校验 revision，旧版本返回 409。所有 storageKey 递归验证归属及上传完成状态，并在同一事务更新引用。画布保持 400 ms 防抖，单画布串行写入，服务端确认后显示已保存。

浏览器 IndexedDB 按用户保存草稿与缓存，AI 密钥和插件私有数据同样隔离。网络失败、保存冲突通过顶部云端状态查看，可手动重试、重新加载或另存副本。不是完整离线模式；不要在处理草稿前清除浏览器存储。登录前不加载个人数据；切换账号/退出通过重载释放内存、请求和 Agent 连接。旧浏览器数据不会自动迁移或清空，WebDAV 入口隐藏。

文件导出包含实际文件，导入先验证全部引用文件存在，再分配新文件标识。不可用外链不能冒充已归档文件。缩略图仅本地缓存。另一设备重新打开页面会加载云端内容；本次不包含实时协作或团队共享。

## 本地开发

从仓库根目录使用两份 Compose 文件，只启动后端和数据库，并令 `.env` 中 `APP_ORIGIN=http://localhost:5173`：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build server
cd web
bun install
bun run dev
```

Vite 将 `/api` 代理至 `127.0.0.1:3001`。初始化管理员时也带上同样两份 `-f` 文件。若本机开发后端，使用 Node.js 22 或更高版本，在 `server` 中 `npm ci`，通过进程环境提供以上变量（包括 DATABASE_URL），然后执行 `npm run db:migrate`、`npm run dev`。

针对性测试（需已安装 web 依赖）：`cd server && npm ci && npm test`。测试采用 PGlite、真实 Better Auth 和模拟对象存储，无需生产数据库或 S3 凭据。项目约定不运行语法检查和构建；Docker、真实 S3 与独立浏览器页面验收清单位于 `docs/content/docs/progress/pending-test.mdx`。

## 文件清理和备份

业务删除仅更新引用，不立即删除文件。没有自动过期清理。维护前先让用户处理未保存草稿；数据库无法知道浏览器草稿还需要哪些未关联文件。

```bash
docker compose exec server npm run files:cleanup
# 查看预览并确认后才执行：
docker compose exec server npm run files:cleanup -- --execute
```

尚有有效上传地址的对象跳过；已引用最终对象保留。执行时先锁用户并检查引用，提交 deleting 状态，随后删除 S3 对象和数据库文件记录。部分删除失败可重跑；deleting 文件不能再关联或完成上传。过期的已完成上传暂存对象也可清理。

上线前及升级前共同备份 PostgreSQL 和 S3，二者缺一不可。维护期间暂停写入与清理，执行数据库逻辑备份（例如 `docker compose exec -T database pg_dump -U canvas canvas > canvas.sql`），并用 S3 服务自身备份/复制能力保存桶内对象；同时妥善保管认证密钥与部署配置。恢复时还原相匹配的数据库和桶，再启动服务。不要使用 `docker compose down -v` 删除业务数据卷。
