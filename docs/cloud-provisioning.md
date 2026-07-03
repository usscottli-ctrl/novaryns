# 云端托管 L3 全自动开通 — 架构与实施计划(2026-07-03 定稿)

> 目标:客户在首页点「开通云端」→ 登录 → 选子域名 → 支付宝/微信扫码付 ¥3,999/年
> → **几分钟内自动开通** `客户名.novaryns.com` 专属实例(含管理员账号)→ 全程零人工。
> 用户 2026-07-03 拍板直接上 L3(跳过 L1/L2 分层)。

## 一、核心架构决策(定稿,别推翻)

| 决策点 | 结论 | 理由 |
|---|---|---|
| 租户隔离模型 | **每客户独立 Docker 实例**(非共享多租户) | 复用现成自托管交付物(镜像/首启向导/门控),代码零侵入;共享多租户要给全部表加 tenant_id,风险巨大 |
| 托管位置 | **双区域(2026-07-03 用户拍板,大陆速度优先)**:**主推大陆区=阿里云杭州 ECS(120.27.128.2)**,海外区=Hetzner(5.78.201.12) | **关键洞察:starzeco.com 已 ICP 备案(粤ICP备2025390640号)→ 大陆租户用 `客户名.starzeco.com` 放阿里云完全合规**、访问快;海外区免备案给出海客户。两台机的 Caddy/GoTrue/nv-postgres 配方完全相同,provision 脚本带 `--region cn|global` 参数 |
| 容量 | CN ECS 4C/7.1G(5.5G 可用)≈10-12 租户;US 4C/7.6G ≈15 租户 | 满了加机器,脚本天然支持多宿主 |
| 域名 | 大陆区 `客户名.starzeco.com`(**通配 `*.starzeco.com` A→120.27.128.2 已于 2026-07-03 加好并验证**,显式记录 ai/cdn 优先不受影响,阿里云解析 RAM key 可自动管理);海外区 `客户名.novaryns.com`(**通配 `*.novaryns.com`→5.78.201.12 灰云,待 CF token 续期后加**) | CF 免费版通配证书只盖一级子域;保留字校验(www/ai/cdn/pay/wx/auth/image/relay/admin/api/cn-origin 等) |
| 租户 OpenAI 出口 | 大陆区实例 env `OPENAI_BASE_URL=https://relay.novaryns.com`(relay IP 白名单已含 120.27.128.2,天然直通);海外区直连 | relay 双通道见 opencore 记忆 |
| 客户自定义域名 | **支持,分区域**:海外区=任意域名 CNAME 即绑(Caddy on_demand_tls + ask 端点校验租户,v2);大陆区=**客户域名必须自己已 ICP 备案**(法规硬性,国内 SaaS 通行做法,绑定时提示并校验) | 未备案域名解析到大陆服务器 80/443 会被阻断,无解 |
| 租户版本 | `NOVARYNS_EDITION=cloud`(全功能解锁) | 云端权益=白标+多用户+收款全含;我们控制宿主机,env 安全 |
| 租户认证 | **每租户一个 GoTrue 容器** + `auth-<name>.novaryns.com` | 复刻现有 gotrue-main/gotrue-cn 配方(容器已在跑,env 清单已核);GoTrue 单用户池,不能共享;v1 用 `GOTRUE_MAILER_AUTOCONFIRM=true` 免 SMTP |
| 租户数据库 | 共享 **nv-postgres**(127.0.0.1:5433,已在跑),每租户两个库:`t_<name>`(应用)+ `t_<name>_auth`(GoTrue) | 单 PG 多库,资源省 |
| 镜像 | **⚠️ 按租户构建**(`docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=… ANON_KEY=…`),~4分钟/租户 | **大坑:`NEXT_PUBLIC_*` 是构建期内联**,共享镜像没法按租户改认证地址。备选方案=入口脚本 sed 替换 .next 里的占位符(更快但 hack),v1 先按租户构建,量大再换 |
| 算力 | 我们的 OpenAI Key 经 env 注入(后台只显掩码),**用 OpenAI 项目级预算上限兜底** | 云端含算力是核心卖点;⚠️ 租户 admin 可自发积分,成本风控靠 OpenAI 侧 budget cap,v2 再做用量计量 |
| 支付 | **只在 CN 站(ai.starzeco.com)自助支付**(原生支付宝/微信已上线) | 海外站无收款渠道;海外「开通云端」引导到 CN 站或保留微信 |
| 跨机编排 | CN 站 fulfill 回调 → **US 机 provisioner 服务**(pm2 小 Node 服务,localhost:97xx,Caddy 反代 + shared secret) | 支付在 CN 杭州,实例在美国 |

## 二、里程碑

- **M1 支付+订单(CN 站)**:cloud 商品(¥3,999/年,`RMB` 399900分);CloudModal 改自助流:登录→填子域名(实时查重 `/api/cloud/check-name`)→扫码支付(复用 recharge-modal 原生轮询)→建 `app_cloud_tenants` 记录(status=pending)。⚠️ 上线前真商户小额实测一笔。
- **M2 Provisioner(US 机)**:`scripts/cloud/provision.sh`(见下配方)+ `provisioner.js`(pm2,POST /provision,shared secret 头,队列串行防并发)。手动可跑=同时兑现 L2。
- **M3 联动**:fulfill → 调 provisioner → 成功置 active + 发开通邮件/站内(URL+管理员初始密码);失败→status=failed 工单,admin 后台「云端租户」列表可重试/人工兜底。
- **M4 生命周期**:cron 查 expires_at→到期 docker stop;续费商品;admin 列表(停/启/删)。

## 三、provision.sh 配方(核心资产)

输入:`name`(子域,^[a-z0-9][a-z0-9-]{2,29}$ + 保留字校验)、`admin_email`、`site_name`。

1. 端口分配:从 4000 起找空闲对(APP_PORT/AUTH_PORT),记录到 `/opt/nv-tenants/registry.json`。
2. 建库:`docker exec nv-postgres createdb t_<name>` ×2;密码复用 nv-postgres 超级用户(内网 127.0.0.1)。
3. 生成密钥:`JWT_SECRET=openssl rand -hex 32`;ANON/SERVICE_ROLE = 用 node 以 HS256 签 `{role:"anon"|"service_role",iss:"supabase"}`(GoTrue/supabase-js 兼容)。
4. GoTrue 容器:`docker run -d --name nv-t-<name>-auth --restart always -p 127.0.0.1:$AUTH_PORT:9999`,env 照抄 gotrue-main 清单(DB_DATABASE_URL 指 172.17.0.1:5433/t_<name>_auth;SITE_URL=https://<name>.novaryns.com;MAILER_AUTOCONFIRM=true;JWT_EXP/API_HOST 等),**必带 `--add-host host.docker.internal:host-gateway`**(CN 迁移踩过的坑)。
5. 应用镜像:宿主机 `/opt/novaryns-src`(git clone 公开仓库,git pull 复用)→ `docker build -t nv-tenant-<name> --build-arg NEXT_PUBLIC_SUPABASE_URL=https://auth-<name>.novaryns.com --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON .`(Dockerfile 需加这两个 ARG→ENV,对 OSS 无害)。
6. 应用容器:`docker run -d --name nv-t-<name> --restart always -p 127.0.0.1:$APP_PORT:3000 -v nv-t-<name>-media:/data/media`,env:`DATABASE_URL`(172.17.0.1:5433/t_<name>)、`SUPABASE_SERVICE_ROLE_KEY`、`NOVARYNS_EDITION=cloud`、`ADMIN_EMAIL=<admin_email>`、`OPENAI_API_KEY`(我们的预算限额 Key)、`SETTINGS_SECRET=rand`、`SITE_NAME`。
7. Caddy:`/home/Caddyfile` 追加(append 保 inode)两个 block:`<name>.novaryns.com → 172.17.0.1:$APP_PORT`、`auth-<name>.novaryns.com → 容器:9999`(照抄 auth.novaryns.com block 的 CORS 处理),`docker exec caddy caddy reload`。
8. 健康检查:curl `https://<name>.novaryns.com/api/health` 直到 200(≤120s)。
9. 输出 JSON:{url, adminEmail, 初始密码(GoTrue admin API 建用户 autoconfirm)}。
10. 回滚:任一步失败,倒序清理本次创建的容器/库/Caddy 块。

## 四、前置依赖(卡点)

1. **通配 DNS `*.novaryns.com` A → 5.78.201.12(必须灰云)** — CF API token 已过期(status=expired),需用户在 Cloudflare 仪表盘手动加,或续期 token 后我加。
2. OpenAI 侧:为云端租户建独立项目 Key + 月度预算上限(用户在 OpenAI 平台操作)。
3. ¥3,999 支付上线前:真商户实测一笔(含退款路径)。

## 五、风控与已知取舍(v1 接受)

- 租户 admin 理论可刷我们的算力 → OpenAI budget cap 兜底,v2 做按租户用量计量/断供。
- 每租户构建 ~4 分钟 → 「几分钟开通」符合预期;量大换占位符替换方案。
- GoTrue autoconfirm(无邮箱验证)→ v2 接 SMTP(gotrue-main 的 SMTP 配置可复用)。
- 自定义域名(客户自有域名 CNAME)→ v2(Caddy on_demand_tls + ask 端点)。
