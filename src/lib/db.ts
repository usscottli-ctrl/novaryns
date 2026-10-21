import "server-only";
import { Pool, type PoolClient } from "pg";
import {
  POINTS_PER_IMAGE,
  type PlanKey,
  type PromptTemplate,
} from "@/lib/mock-data";
import type { SessionUser, Invoice } from "@/lib/auth-context";
import { provisionTenant, resumeTenant, provisionerConfigured } from "@/lib/provisioner";
import { normalizeSubdomain, cloudDomainFor, parseCloudItemId } from "@/lib/cloud";
import {
  ANALYTICS_TZ,
  type AnalyticsOverview,
  type CountRow,
  type DailyRow,
} from "@/lib/analytics";

// ---------------------------------------------------------------------------
// Postgres persistence. Active only when DATABASE_URL is set; otherwise the
// app keeps using the client-side localStorage mock. Schema is created on
// first use (CREATE TABLE IF NOT EXISTS) so no separate migration step is
// needed for the MVP — swap for proper migrations before production.
// ---------------------------------------------------------------------------

export const dbEnabled = (process.env.DATABASE_URL ?? "").trim().length > 0;

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    const cs = connectionString || "";
    // 本地 / Docker 内网 / 显式 sslmode=disable → 不启用 SSL:自建或 compose 自带的
    // Postgres 默认不支持 SSL(host 常见为 db / localhost / 127.* / 私有网段 / 容器名)。
    // 只有远程托管库(如 Supabase 公网域名)才保留 SSL。
    const noSsl =
      /sslmode=disable/.test(cs) ||
      /@(localhost|127\.0\.0\.1|db|postgres|nv-postgres|host\.docker\.internal)[:/]/.test(cs) ||
      /@(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(cs);
    pool = new Pool({
      connectionString,
      ssl: noSsl ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS app_users (
          email         text PRIMARY KEY,
          name          text NOT NULL,
          plan          text NOT NULL DEFAULT 'starter',
          credits_total integer NOT NULL DEFAULT 20,
          credits_used  integer NOT NULL DEFAULT 0,
          joined_at     timestamptz NOT NULL DEFAULT now(),
          renews_at     timestamptz NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_invoices (
          id         text PRIMARY KEY,
          email      text NOT NULL REFERENCES app_users(email) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          plan       text NOT NULL,
          amount     integer NOT NULL,
          status     text NOT NULL DEFAULT 'paid'
        );
        CREATE TABLE IF NOT EXISTS app_artworks (
          id         text PRIMARY KEY,
          email      text NOT NULL,
          title      text NOT NULL,
          category   text NOT NULL,
          prompt     text NOT NULL,
          status     text NOT NULL DEFAULT 'completed',
          image_url  text NOT NULL,
          gradient   text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS app_artworks_email_idx
          ON app_artworks (email, created_at DESC);
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS style text;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS ratio text;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS source_url text;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS batch_id text;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS resolution text;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS parent_id text;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS parent_ids jsonb DEFAULT '[]'::jsonb;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS template_id text;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS canvas_x double precision;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS canvas_y double precision;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS origin text;
        -- 稳定项目分组:同一画布项目的所有节点共享 group_id,删中间节点也不改它,
        -- 避免"删一个连接节点 → 下游节点跑去别的项目"。
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS group_id text;
        -- 出图当时的计费与参数快照。**必须落库,不能事后推算**:积分单价/质量倍率
        -- 以后会调,用今天的表去算历史订单必然对不上。客户要能回答
        -- 「这张图什么时候生成的、什么参数、扣了几分」(2026-08-17 客户实际质疑扣分)。
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS cost integer;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS quality text;
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS model text;
        -- 这张图实际消耗的上游 output tokens。**成本核算的唯一可靠依据**:
        -- 积分单价此前靠"实测一档 + 倍率外推"估算,4K 因此被高估一倍、险些据此涨价 22%。
        -- 有了这一列,跑一两个月就能用真实用量算成本,不必再凭单次实测推断。
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS tokens integer;
        -- 软删除/回收站:deleted_at 非空=已删(进回收站),空=正常。保留 N 天后才真删。
        ALTER TABLE app_artworks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS app_artworks_deleted_idx
          ON app_artworks (email, deleted_at);
        -- 回填历史数据:给每个节点写入它当前所在血缘树的"根节点 id"作为 group_id。
        WITH RECURSIVE chain AS (
          SELECT id, email, parent_id, id AS root
            FROM app_artworks a
           WHERE parent_id IS NULL
              OR NOT EXISTS (
                   SELECT 1 FROM app_artworks p
                    WHERE p.id = a.parent_id AND p.email = a.email)
          UNION ALL
          SELECT a.id, a.email, a.parent_id, c.root
            FROM app_artworks a
            JOIN chain c ON a.parent_id = c.id AND a.email = c.email
        )
        UPDATE app_artworks t
           SET group_id = chain.root
          FROM chain
         WHERE t.id = chain.id AND t.email = chain.email AND t.group_id IS NULL;
        CREATE TABLE IF NOT EXISTS app_settings (
          k          text PRIMARY KEY,
          v          text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS app_project_names (
          email      text NOT NULL,
          key        text NOT NULL,
          name       text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (email, key)
        );
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
        CREATE TABLE IF NOT EXISTS app_ledger (
          id         text PRIMARY KEY,
          email      text NOT NULL,
          delta      integer NOT NULL,
          reason     text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS app_ledger_created_idx
          ON app_ledger (created_at DESC);
        ALTER TABLE app_users ALTER COLUMN credits_total SET DEFAULT 20;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_ip text;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone text;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash text;
        CREATE UNIQUE INDEX IF NOT EXISTS app_users_phone_idx
          ON app_users (phone) WHERE phone IS NOT NULL;
        CREATE TABLE IF NOT EXISTS app_banned_ips (
          ip         text PRIMARY KEY,
          reason     text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS app_templates (
          id          text PRIMARY KEY,
          title       text NOT NULL,
          category    text NOT NULL DEFAULT '',
          industry    text NOT NULL DEFAULT '',
          description text NOT NULL DEFAULT '',
          prompt      text NOT NULL DEFAULT '',
          tags        text[] NOT NULL DEFAULT '{}',
          image       text NOT NULL DEFAULT '',
          gradient    text NOT NULL DEFAULT 'from-emerald-100 to-teal-100',
          popular     boolean NOT NULL DEFAULT false,
          sort_index  integer NOT NULL DEFAULT 0,
          updated_at  timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS app_templates_sort_idx
          ON app_templates (sort_index DESC, id ASC);
        ALTER TABLE app_templates ADD COLUMN IF NOT EXISTS homepage_featured boolean NOT NULL DEFAULT false;
        CREATE INDEX IF NOT EXISTS app_templates_homepage_idx
          ON app_templates (homepage_featured) WHERE homepage_featured = true;
        -- 白底原图:作品转模板时把原作品的 source_url(用户上传的白底产品图)带进来,
        -- 这样别人点「做同款」时左侧产品图能带出白底原图(爬来的库模板无此值,留空)。
        ALTER TABLE app_templates ADD COLUMN IF NOT EXISTS source_image text NOT NULL DEFAULT '';
        CREATE TABLE IF NOT EXISTS app_user_favs (
          email       text NOT NULL,
          template_id text NOT NULL,
          created_at  timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (email, template_id)
        );
        CREATE INDEX IF NOT EXISTS app_user_favs_email_idx
          ON app_user_favs (email, created_at DESC);
        CREATE TABLE IF NOT EXISTS app_gen_reservations (
          job_id     text PRIMARY KEY,
          email      text NOT NULL,
          cost       integer NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS app_orders (
          id           text PRIMARY KEY,
          email        text NOT NULL,
          kind         text NOT NULL,                 -- 'plan' | 'pack'
          item_id      text NOT NULL,                 -- plan key or pack id
          title        text NOT NULL DEFAULT '',
          credits      integer NOT NULL DEFAULT 0,
          amount       integer NOT NULL,              -- 分 (RMB cents)
          status       text NOT NULL DEFAULT 'pending', -- pending|paid|failed|expired
          provider     text NOT NULL DEFAULT '',      -- wechat|alipay|mock
          provider_txn text,
          created_at   timestamptz NOT NULL DEFAULT now(),
          paid_at      timestamptz
        );
        CREATE INDEX IF NOT EXISTS app_orders_email_idx
          ON app_orders (email, created_at DESC);
        CREATE TABLE IF NOT EXISTS app_genchat_sessions (
          id         text PRIMARY KEY,
          email      text NOT NULL,
          title      text NOT NULL DEFAULT '',
          turns      jsonb NOT NULL DEFAULT '[]',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS app_genchat_email_idx
          ON app_genchat_sessions (email, updated_at DESC);
        -- 积分批次:每次充值/赠送/迁移 = 一个批次,带自己的到期日(2 年 / 新人 30 天)。
        -- 余额 = 所有「未到期且 remaining>0」批次的 remaining 之和;消耗按「先到期先扣」FIFO。
        -- remaining 到期后不清零(留作记录),靠 expires_at>now() 过滤;expired 仅用于「只记一次过期流水」。
        CREATE TABLE IF NOT EXISTS app_credit_batches (
          id         text PRIMARY KEY,
          email      text NOT NULL,
          amount     integer NOT NULL,            -- 批次原始积分
          remaining  integer NOT NULL,            -- 剩余(FIFO 扣减)
          source     text NOT NULL,               -- purchase|grant|migrate|admin
          reason     text NOT NULL DEFAULT '',
          order_id   text,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          expired    boolean NOT NULL DEFAULT false
        );
        CREATE INDEX IF NOT EXISTS app_credit_batches_live_idx
          ON app_credit_batches (email, expires_at);
        -- 流水扩列:kind 给明细页分类(purchase/consume/grant/refund/expire);
        -- expires_at 给「购买/获取」类流水显示到期时间。
        ALTER TABLE app_ledger ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT '';
        ALTER TABLE app_ledger ADD COLUMN IF NOT EXISTS expires_at timestamptz;
        -- 这笔扣费对应哪次生成(= app_artworks.batch_id)。没有它,账户页的扣分明细
        -- 就只是一行"生成 1 张图 -23",客户点不进去、也对不上是哪张图
        -- (2026-08-17 客户原话:「查看扣分记录但是对应不到图片」)。
        ALTER TABLE app_ledger ADD COLUMN IF NOT EXISTS ref_id text;
        CREATE INDEX IF NOT EXISTS app_ledger_ref_idx ON app_ledger (email, ref_id);
        -- 兑换码:站长后台批量生成,用户在充值弹窗兑换成积分(走 addCreditBatch grant)。
        CREATE TABLE IF NOT EXISTS app_card_keys (
          code       text PRIMARY KEY,                 -- NOVA-XXXX-XXXX-XXXX
          credits    integer NOT NULL,
          status     text NOT NULL DEFAULT 'unused',   -- unused|used|disabled
          batch      text NOT NULL DEFAULT '',
          note       text NOT NULL DEFAULT '',
          expires_at timestamptz,                      -- null = 永久
          created_at timestamptz NOT NULL DEFAULT now(),
          used_by    text,
          used_at    timestamptz
        );
        CREATE INDEX IF NOT EXISTS app_card_keys_status_idx
          ON app_card_keys (status, created_at DESC);

        -- 邀请有奖(2026-10-21):每个用户一个邀请码 + 自定义推广语
        CREATE TABLE IF NOT EXISTS app_invite_codes (
          email      text PRIMARY KEY,
          code       text NOT NULL UNIQUE,
          slogan     text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now()
        );
        -- 邀请关系:一个被邀请人只能绑定一次;记录每笔奖励,便于后台核对/撤销
        CREATE TABLE IF NOT EXISTS app_invites (
          invitee          text PRIMARY KEY,
          inviter          text NOT NULL,
          code             text NOT NULL,
          ip               text NOT NULL DEFAULT '',
          invitee_reward   integer NOT NULL DEFAULT 0,
          signup_reward    integer NOT NULL DEFAULT 0,
          recharge_reward  integer NOT NULL DEFAULT 0,
          recharged_at     timestamptz,
          note             text NOT NULL DEFAULT '',
          revoked          boolean NOT NULL DEFAULT false,
          created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS app_invites_inviter_idx
          ON app_invites (inviter, created_at DESC);
        CREATE INDEX IF NOT EXISTS app_invites_ip_idx
          ON app_invites (ip, created_at DESC);

        -- 云端托管「开通码」:淘宝等渠道拍下后自动发码,买家自助到 /cloud/redeem
        -- 填子域名+管理员邮箱换实例。一码 = 一个套餐(月付/年付),核销后合成一张
        -- 金额为 0 的已付 cloud 订单,复用与线上支付完全相同的开通/续费/生命周期链路。
        CREATE TABLE IF NOT EXISTS app_cloud_codes (
          code       text PRIMARY KEY,                 -- NVCL-XXXX-XXXX-XXXX
          plan_id    text NOT NULL,                    -- monthly|yearly(见 CLOUD_PLANS)
          status     text NOT NULL DEFAULT 'unused',   -- unused|used|disabled
          batch      text NOT NULL DEFAULT '',
          note       text NOT NULL DEFAULT '',
          expires_at timestamptz,                      -- 核销截止;null = 永久
          created_at timestamptz NOT NULL DEFAULT now(),
          used_by    text,
          used_at    timestamptz,
          order_id   text                              -- 核销时合成的订单,失败可换名重试
        );
        CREATE INDEX IF NOT EXISTS app_cloud_codes_status_idx
          ON app_cloud_codes (status, created_at DESC);

        -- Pro 自托管授权 License(爱发电售卖/发货的产品)。
        CREATE TABLE IF NOT EXISTS app_licenses (
          key          text PRIMARY KEY,                 -- NOVA-XXXX-XXXX-XXXX-XXXX
          tier         text NOT NULL DEFAULT 'pro',
          status       text NOT NULL DEFAULT 'active',   -- active|revoked
          device_limit integer NOT NULL DEFAULT 3,       -- 可绑定部署/设备数
          expires_at   timestamptz,                      -- null = 永久
          batch        text NOT NULL DEFAULT '',
          note         text NOT NULL DEFAULT '',
          bound_email  text,
          created_at   timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS app_licenses_created_idx
          ON app_licenses (created_at DESC);
        -- Pro 实例激活(每个部署 host 一条),用于设备数限制 + 我的授权页展示。
        CREATE TABLE IF NOT EXISTS app_license_activations (
          id           bigserial PRIMARY KEY,
          license_key  text NOT NULL REFERENCES app_licenses(key) ON DELETE CASCADE,
          host         text NOT NULL,
          active       boolean NOT NULL DEFAULT true,
          activated_at timestamptz NOT NULL DEFAULT now(),
          last_seen    timestamptz NOT NULL DEFAULT now(),
          UNIQUE (license_key, host)
        );
        CREATE INDEX IF NOT EXISTS app_license_act_key_idx
          ON app_license_activations (license_key);
        -- 云端托管租户:一个已付「cloud」订单 → 一个专属实例(<subdomain>.starzeco.com)。
        -- order_id 幂等键;付款后 ensureCloudTenantForOrder 认领 provisioning→调开通服务→active/failed。
        CREATE TABLE IF NOT EXISTS app_cloud_tenants (
          order_id       text PRIMARY KEY,               -- = 触发开通的订单(幂等键)
          email          text NOT NULL,                  -- 买家 = 租户管理员邮箱
          subdomain      text NOT NULL,                  -- 子域名(<sub>.starzeco.com)
          region         text NOT NULL DEFAULT 'cn',
          status         text NOT NULL DEFAULT 'pending',-- pending|provisioning|active|failed|suspended|purged
          url            text,                           -- https://<sub>.starzeco.com
          admin_password text,                           -- 初始管理员密码(一次性,买家应尽快修改)
          error          text,                           -- 失败原因(展示/工单)
          expires_at     timestamptz,
          created_at     timestamptz NOT NULL DEFAULT now(),
          provisioned_at timestamptz,
          updated_at     timestamptz NOT NULL DEFAULT now()
        );
        -- 续费追踪(M4):last_order_id = 最近一次续费订单(供该订单的 provision/poll 解析到本租户)。
        ALTER TABLE app_cloud_tenants ADD COLUMN IF NOT EXISTS last_order_id text;
        ALTER TABLE app_cloud_tenants ADD COLUMN IF NOT EXISTS renewed_at timestamptz;
        ALTER TABLE app_cloud_tenants ADD COLUMN IF NOT EXISTS renewals integer NOT NULL DEFAULT 0;
        -- 自定义域名(逗号分隔,v1 单个);到期前提醒发送时间(续费后清空以便下轮再提醒)。
        ALTER TABLE app_cloud_tenants ADD COLUMN IF NOT EXISTS custom_domains text NOT NULL DEFAULT '';
        ALTER TABLE app_cloud_tenants ADD COLUMN IF NOT EXISTS remind_sent_at timestamptz;
        -- 同一子域名同一时刻只允许一个「在途/活跃」占用;失败/销毁的不占名(可重开)。
        CREATE UNIQUE INDEX IF NOT EXISTS app_cloud_tenants_sub_live_idx
          ON app_cloud_tenants (subdomain)
          WHERE status IN ('pending','provisioning','active','suspended');
        CREATE INDEX IF NOT EXISTS app_cloud_tenants_email_idx
          ON app_cloud_tenants (email, created_at DESC);
        CREATE INDEX IF NOT EXISTS app_cloud_tenants_status_exp_idx
          ON app_cloud_tenants (status, expires_at);
        -- 云端算力充值台账:一个已付 compute 订单 → 给中转 token 加一次配额(幂等键=order_id)。
        CREATE TABLE IF NOT EXISTS app_compute_topups (
          order_id   text PRIMARY KEY,
          token_id   text NOT NULL,
          credits    integer NOT NULL,
          status     text NOT NULL DEFAULT 'pending', -- pending|applied|failed
          error      text,
          created_at timestamptz NOT NULL DEFAULT now(),
          applied_at timestamptz
        );
        -- 站点访问统计:一次页面浏览一行(自建轻量 analytics,见 lib/analytics.ts)。
        -- 隐私:不存原始 IP / 完整 UA。visitor = sha256(站点密钥 + IP + UA) 取前 32 位,
        -- 不可逆,只用于 UV 去重。day 在写入时按 ANALYTICS_TZ 算好,查询才能直接走索引。
        CREATE TABLE IF NOT EXISTS app_page_views (
          id       bigserial PRIMARY KEY,
          ts       timestamptz NOT NULL DEFAULT now(),
          day      date NOT NULL,
          path     text NOT NULL,
          visitor  text NOT NULL,
          sid      text NOT NULL DEFAULT '',
          country  text,
          device   text NOT NULL DEFAULT 'desktop',
          browser  text NOT NULL DEFAULT '',
          ref_host text NOT NULL DEFAULT '',
          locale   text NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS app_page_views_day_idx
          ON app_page_views (day);
        CREATE INDEX IF NOT EXISTS app_page_views_ts_idx
          ON app_page_views (ts DESC);
        -- 视频生成任务(火山引擎方舟 Seedance 异步):创建时预扣积分并记一行 pending,
        -- 前端轮询 /api/video/status 时按 task_id 结算 —— 成功落作品、失败退积分。
        -- status 只能 pending → succeeded|failed 单向转一次(见 settleVideoJob 的
        -- WHERE status='pending' ... RETURNING),否则并发轮询会重复退款/重复落库。
        CREATE TABLE IF NOT EXISTS app_video_jobs (
          task_id    text PRIMARY KEY,
          email      text NOT NULL,
          cost       integer NOT NULL DEFAULT 0,
          status     text NOT NULL DEFAULT 'pending', -- pending|succeeded|failed
          title      text NOT NULL DEFAULT '',
          prompt     text NOT NULL DEFAULT '',
          resolution text NOT NULL DEFAULT '',
          duration   integer NOT NULL DEFAULT 0,
          source_url text,
          parent_id  text,
          artwork_id text,
          video_url  text,
          error      text,
          created_at timestamptz NOT NULL DEFAULT now(),
          settled_at timestamptz
        );
        CREATE INDEX IF NOT EXISTS app_video_jobs_email_idx
          ON app_video_jobs (email, created_at DESC);
      `);
    })();
  }
  return schemaReady;
}

/** Lightweight connectivity probe used by /api/health. */
export async function pingDb(): Promise<{ ok: boolean; error?: string }> {
  if (!dbEnabled) return { ok: false, error: "DATABASE_URL 未配置" };
  try {
    await getPool().query("SELECT 1");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "数据库连接失败",
    };
  }
}

// 从现在起算满一个月（滚动月，保留日期）。用于注册占位、管理员授予会员等。
// 付款续费/购买走 fulfillOrder 内的 SQL（支持到期日累加）。
function oneMonthFromNowISO(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

// ===========================================================================
// 积分批次(2 年有效 / 新人 30 天) + 消费 FIFO + 过期处理
// ---------------------------------------------------------------------------
// 模型:批次(app_credit_batches)是「本金」的唯一真源;app_users.credits_used
// 当「在途占位」(预扣未结算)。可用余额 = 活批次 remaining 之和;remaining = 该
// 余额减去 credits_used(占位)。消费在「结算」(addLedgerEntry 负数)时才真正按
// FIFO 扣本金。credits_total 列保留为余额镜像(refreshBalance 同步,后台直读用)。
// ===========================================================================

function ledId(prefix = "led"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function twoYearsFromNow(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return d;
}

/** 过期处理:已过期(expires_at<=now)且未记过期流水的批次,记一条「积分过期」
 *  流水(delta=-remaining)并标记 expired。单条 SQL 原子完成,可重复调用(expired
 *  守护 + led-exp-<id> 主键防重)。remaining 不清零(留作记录),余额靠 expires_at 过滤。 */
async function expireDueBatches(emailRaw: string): Promise<void> {
  await getPool().query(
    `WITH upd AS (
       UPDATE app_credit_batches
          SET expired = true
        WHERE email = $1 AND expires_at <= now() AND remaining > 0 AND expired = false
        RETURNING id, remaining
     )
     INSERT INTO app_ledger (id, email, delta, reason, kind, created_at)
     SELECT 'led-exp-' || id, $1, -remaining, '积分过期', 'expire', now()
       FROM upd
     ON CONFLICT (id) DO NOTHING`,
    [emailRaw.toLowerCase()]
  );
}

/** 当前可用余额 = 未到期且 remaining>0 的批次之和。 */
async function liveBatchBalance(emailRaw: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COALESCE(SUM(remaining),0)::int AS s
       FROM app_credit_batches
      WHERE email = $1 AND expires_at > now() AND remaining > 0`,
    [emailRaw.toLowerCase()]
  );
  return rows[0]?.s ?? 0;
}

/** 跑过期 → 算余额 → 把 credits_total 同步成该余额(后台列表直读)。返回余额。 */
async function refreshBalance(emailRaw: string): Promise<number> {
  const email = emailRaw.toLowerCase();
  await expireDueBatches(email);
  const bal = await liveBatchBalance(email);
  await getPool()
    .query(`UPDATE app_users SET credits_total = $2 WHERE email = $1`, [email, bal])
    .catch(() => {});
  return bal;
}

/** 事务内按 FIFO(先到期先扣)从活批次扣 n 本金。返回实际扣到的数(正常 = n)。 */
async function deductPrincipalFIFO(
  client: PoolClient,
  email: string,
  n: number
): Promise<number> {
  if (n <= 0) return 0;
  const { rows } = await client.query(
    `SELECT id, remaining FROM app_credit_batches
      WHERE email = $1 AND expires_at > now() AND remaining > 0
      ORDER BY expires_at ASC, created_at ASC
      FOR UPDATE`,
    [email]
  );
  let need = n;
  for (const b of rows as { id: string; remaining: number }[]) {
    if (need <= 0) break;
    const take = Math.min(b.remaining, need);
    await client.query(
      `UPDATE app_credit_batches SET remaining = remaining - $2 WHERE id = $1`,
      [b.id, take]
    );
    need -= take;
  }
  return n - need;
}

/** 新建积分批次(充值/赠送/迁移/后台)+ 写 +流水 + 同步余额。 */
export async function addCreditBatch(
  emailRaw: string,
  amount: number,
  opts: {
    source: "purchase" | "grant" | "migrate" | "admin";
    reason: string;
    expiresAt?: Date; // 默认 2 年;赠送由调用方传 30 天
    orderId?: string | null;
    ledgerKind?: "purchase" | "grant";
  }
): Promise<void> {
  await ensureSchema();
  if (amount <= 0) return;
  const email = emailRaw.toLowerCase();
  const expires = (opts.expiresAt ?? twoYearsFromNow()).toISOString();
  const kind =
    opts.ledgerKind ?? (opts.source === "purchase" ? "purchase" : "grant");
  await getPool().query(
    `INSERT INTO app_credit_batches
       (id, email, amount, remaining, source, reason, order_id, expires_at)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7)`,
    [ledId("bat"), email, amount, opts.source, opts.reason, opts.orderId ?? null, expires]
  );
  await getPool().query(
    `INSERT INTO app_ledger (id, email, delta, reason, kind, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
    [ledId(), email, amount, opts.reason, kind, expires]
  );
  await refreshBalance(email);
}

// ===========================================================================
// 兑换码(app_card_keys):站长批量发码 → 用户兑换 → addCreditBatch grant 加积分
// ===========================================================================

export type CardKeyRow = {
  code: string;
  credits: number;
  status: "unused" | "used" | "disabled";
  batch: string;
  note: string;
  expires_at: Date | null;
  created_at: Date;
  used_by: string | null;
  used_at: Date | null;
};

// 无歧义字符集(去掉 0/O/1/I/L),NOVA-XXXX-XXXX-XXXX。
const CARD_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randCardCode(): string {
  const seg = () =>
    Array.from(
      { length: 4 },
      () => CARD_CHARSET[Math.floor(Math.random() * CARD_CHARSET.length)]
    ).join("");
  return `NOVA-${seg()}-${seg()}-${seg()}`;
}

/** 批量生成兑换码(站长后台)。expiryDays=null → 永久。 */
export async function generateCardKeys(opts: {
  credits: number;
  count: number;
  expiryDays: number | null;
  batch: string;
  note: string;
}): Promise<CardKeyRow[]> {
  await ensureSchema();
  const expires =
    opts.expiryDays && opts.expiryDays > 0
      ? new Date(Date.now() + opts.expiryDays * 86400000).toISOString()
      : null;
  const out: CardKeyRow[] = [];
  for (let i = 0; i < opts.count; i++) {
    // 重试避免 PK 撞码(概率极低)。
    let inserted: CardKeyRow | null = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const code = randCardCode();
      const { rows } = await getPool().query<CardKeyRow>(
        `INSERT INTO app_card_keys (code, credits, batch, note, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO NOTHING
         RETURNING code, credits, status, batch, note, expires_at, created_at, used_by, used_at`,
        [code, opts.credits, opts.batch, opts.note, expires]
      );
      if (rows[0]) inserted = rows[0];
    }
    if (inserted) out.push(inserted);
  }
  return out;
}

/** 列出兑换码(最近 500 条,站长后台)。 */
export async function listCardKeys(): Promise<CardKeyRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query<CardKeyRow>(
    `SELECT code, credits, status, batch, note, expires_at, created_at, used_by, used_at
       FROM app_card_keys ORDER BY created_at DESC LIMIT 500`
  );
  return rows;
}

/** 停用 / 恢复(已使用的不可改)。 */
export async function setCardKeyStatus(
  code: string,
  status: "unused" | "disabled"
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE app_card_keys SET status = $2 WHERE code = $1 AND status <> 'used'`,
    [code, status]
  );
}

/** 兑换:原子领取(unused→used)后用 grant 批次加积分。失败抛中文原因。 */
export async function redeemCardKey(
  codeRaw: string,
  emailRaw: string
): Promise<{ credits: number }> {
  await ensureSchema();
  const code = codeRaw.trim().toUpperCase();
  const email = emailRaw.toLowerCase();
  // 原子领取:只有 unused 且未过期才翻成 used,防并发重复兑换。
  const { rows } = await getPool().query<{ credits: number }>(
    `UPDATE app_card_keys
        SET status = 'used', used_by = $2, used_at = now()
      WHERE code = $1 AND status = 'unused'
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING credits`,
    [code, email]
  );
  if (!rows[0]) {
    const { rows: chk } = await getPool().query<{
      status: string;
      expires_at: Date | null;
    }>(`SELECT status, expires_at FROM app_card_keys WHERE code = $1`, [code]);
    if (!chk[0]) throw new Error("兑换码不存在");
    if (chk[0].status === "used") throw new Error("兑换码已被使用");
    if (chk[0].status === "disabled") throw new Error("兑换码已停用");
    if (chk[0].expires_at && chk[0].expires_at <= new Date())
      throw new Error("兑换码已过期");
    throw new Error("兑换码无效");
  }
  const credits = rows[0].credits;
  await addCreditBatch(email, credits, {
    source: "grant",
    reason: "兑换码",
    ledgerKind: "grant",
  });
  return { credits };
}

/** 兑换码统计(站长后台卡片)。 */
export async function cardKeyStats(): Promise<{
  issued: number;
  used: number;
  creditsRedeemed: number;
}> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    issued: string;
    used: string;
    credits_redeemed: string;
  }>(
    `SELECT COUNT(*) AS issued,
            COUNT(*) FILTER (WHERE status = 'used') AS used,
            COALESCE(SUM(credits) FILTER (WHERE status = 'used'), 0) AS credits_redeemed
       FROM app_card_keys`
  );
  const r = rows[0];
  return {
    issued: Number(r?.issued ?? 0),
    used: Number(r?.used ?? 0),
    creditsRedeemed: Number(r?.credits_redeemed ?? 0),
  };
}

// ===========================================================================
// 云端托管开通码(app_cloud_codes):渠道(淘宝)拍下自动发码 → 买家自助核销开站
// ---------------------------------------------------------------------------
// 为什么绕一圈合成订单,而不直接调开通服务:开通/续费/到期挂起/恢复整条链路都是
// 按 order_id 幂等的(ensureCloudTenantForOrder / M4 生命周期任务)。让开通码也产出
// 一张订单,这些能力全部免费复用,后台「云端租户」面板也能原样看到这个租户。
// 订单金额记 0 —— 钱是在渠道侧收的,站内账不重复计收入。
// ===========================================================================

export type CloudCodeRow = {
  code: string;
  plan_id: string;
  status: "unused" | "used" | "disabled";
  batch: string;
  note: string;
  expires_at: Date | null;
  created_at: Date;
  used_by: string | null;
  used_at: Date | null;
  order_id: string | null;
};

const CLOUD_CODE_COLS =
  "code, plan_id, status, batch, note, expires_at, created_at, used_by, used_at, order_id";

// 与卡密同字符集(去掉 0/O/1/I/L),但前缀 NVCL 便于人工一眼区分「开通码 ≠ 积分卡密」。
function randCloudCode(): string {
  const seg = () =>
    Array.from(
      { length: 4 },
      () => CARD_CHARSET[Math.floor(Math.random() * CARD_CHARSET.length)]
    ).join("");
  return `NVCL-${seg()}-${seg()}-${seg()}`;
}

/** 批量生成开通码(站长后台)。expiryDays=null → 永久。 */
export async function generateCloudCodes(opts: {
  planId: string;
  count: number;
  expiryDays: number | null;
  batch: string;
  note: string;
}): Promise<CloudCodeRow[]> {
  await ensureSchema();
  const expires =
    opts.expiryDays && opts.expiryDays > 0
      ? new Date(Date.now() + opts.expiryDays * 86400000).toISOString()
      : null;
  const out: CloudCodeRow[] = [];
  for (let i = 0; i < opts.count; i++) {
    let inserted: CloudCodeRow | null = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const { rows } = await getPool().query<CloudCodeRow>(
        `INSERT INTO app_cloud_codes (code, plan_id, batch, note, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO NOTHING
         RETURNING ${CLOUD_CODE_COLS}`,
        [randCloudCode(), opts.planId, opts.batch, opts.note, expires]
      );
      if (rows[0]) inserted = rows[0];
    }
    if (inserted) out.push(inserted);
  }
  return out;
}

export async function listCloudCodes(): Promise<CloudCodeRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query<CloudCodeRow>(
    `SELECT ${CLOUD_CODE_COLS} FROM app_cloud_codes ORDER BY created_at DESC LIMIT 500`
  );
  return rows;
}

/** 停用 / 恢复(已核销的不可改)。 */
export async function setCloudCodeStatus(
  code: string,
  status: "unused" | "disabled"
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE app_cloud_codes SET status = $2 WHERE code = $1 AND status <> 'used'`,
    [code, status]
  );
}

export async function cloudCodeStats(): Promise<{ issued: number; used: number }> {
  await ensureSchema();
  const { rows } = await getPool().query<{ issued: string; used: string }>(
    `SELECT COUNT(*) AS issued, COUNT(*) FILTER (WHERE status = 'used') AS used
       FROM app_cloud_codes`
  );
  return { issued: Number(rows[0]?.issued ?? 0), used: Number(rows[0]?.used ?? 0) };
}

export type CloudCodeCheck =
  | { ok: true; planId: string; orderId: string | null; retryable: boolean }
  | { ok: false; error: string };

/** 查码(核销前给买家看套餐)。已核销但开通失败的 → retryable,可换名重试。 */
export async function inspectCloudCode(codeRaw: string): Promise<CloudCodeCheck> {
  await ensureSchema();
  const code = codeRaw.trim().toUpperCase();
  const { rows } = await getPool().query<CloudCodeRow>(
    `SELECT ${CLOUD_CODE_COLS} FROM app_cloud_codes WHERE code = $1`,
    [code]
  );
  const r = rows[0];
  if (!r) return { ok: false, error: "开通码不存在" };
  if (r.status === "disabled") return { ok: false, error: "开通码已停用,请联系客服" };
  if (r.expires_at && r.expires_at <= new Date() && r.status === "unused") {
    return { ok: false, error: "开通码已过期" };
  }
  if (r.status === "used") {
    // 已核销:开通失败才允许换名重试,成功/开通中一律拒绝(防重复开站)。
    const t = r.order_id ? await getCloudTenantByOrder(r.order_id) : null;
    if (t && t.status === "failed") {
      return { ok: true, planId: r.plan_id, orderId: r.order_id, retryable: true };
    }
    return { ok: false, error: "开通码已使用" };
  }
  return { ok: true, planId: r.plan_id, orderId: null, retryable: false };
}

/** 核销开通码 → 合成一张已付 cloud 订单并触发开通。返回订单号供前端轮询。
 *  先建订单再原子认领码:认领失败只会留下一张无害的 pending 订单,
 *  绝不会出现「码被烧掉却没有对应订单」的黑洞。 */
export async function claimCloudCode(
  codeRaw: string,
  emailRaw: string,
  subRaw: string
): Promise<{ orderId: string }> {
  await ensureSchema();
  const code = codeRaw.trim().toUpperCase();
  const email = emailRaw.trim().toLowerCase();
  const { findCloudPlan, normalizeSubdomain, subdomainError } = await import("@/lib/cloud");
  const sub = normalizeSubdomain(subRaw);

  const fmtErr = subdomainError(sub);
  if (fmtErr) throw new Error(fmtErr);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("请填写正确的邮箱");

  const pre = await inspectCloudCode(code);
  if (!pre.ok) throw new Error(pre.error);
  const plan = findCloudPlan(pre.planId);
  if (!plan) throw new Error("开通码套餐异常,请联系客服");

  // 抢在核销前查占用,避免买家因撞名白烧一张码(仍有并发窗口,由开通阶段兜底)。
  if (await isCloudSubdomainTaken(sub)) throw new Error("该名称已被占用,请换一个");

  const order = await createOrder({
    email,
    kind: "cloud",
    itemId: `${sub}@${plan.id}`,
    title: `云端托管 · ${plan.label}(开通码)`,
    credits: plan.credits,
    amount: 0, // 钱在渠道侧收,站内不重复计收入
  });

  // 原子认领:unused → used;或「已核销但开通失败」→ 换新订单重试。
  const { rows } = await getPool().query<{ code: string }>(
    `UPDATE app_cloud_codes
        SET status = 'used', used_by = $2, used_at = now(), order_id = $3
      WHERE code = $1
        AND (
          (status = 'unused' AND (expires_at IS NULL OR expires_at > now()))
          OR (status = 'used' AND order_id = $4)
        )
      RETURNING code`,
    [code, email, order.id, pre.retryable ? pre.orderId : null]
  );
  if (!rows[0]) {
    // 没抢到 = 并发下已被别处核销。刚建的 pending 订单留作审计,不影响买家。
    const again = await inspectCloudCode(code);
    throw new Error(again.ok ? "开通码正在使用中,请稍后重试" : again.error);
  }

  // 标记已付 → 内部 fire-and-forget 触发 ensureCloudTenantForOrder;前端轮询 /api/cloud/tenant。
  await fulfillOrder(order.id, "cloudcode", code);
  return { orderId: order.id };
}

// ─────────────────────────────────────────────────────────────────────
// Pro 自托管授权 License。License Key = 爱发电售卖/发货的产品;Pro 实例
// 启动时调 /api/license/activate 绑定 host、校验有效期与设备数上限。
// ─────────────────────────────────────────────────────────────────────

export type LicenseRow = {
  key: string;
  tier: string;
  status: string; // active|revoked
  device_limit: number;
  expires_at: Date | null;
  batch: string;
  note: string;
  bound_email: string | null;
  created_at: Date;
};

// License Key = 5 段,与积分兑换码(4 段)区分。
function randLicenseKey(): string {
  const seg = () =>
    Array.from(
      { length: 4 },
      () => CARD_CHARSET[Math.floor(Math.random() * CARD_CHARSET.length)]
    ).join("");
  return `NOVA-${seg()}-${seg()}-${seg()}-${seg()}`;
}

/** 批量生成 Pro License(站长后台;导出后上传爱发电卡密池发货)。expiryDays=null → 永久。 */
export async function generateLicenses(opts: {
  count: number;
  tier?: string;
  deviceLimit?: number;
  expiryDays: number | null;
  batch: string;
  note: string;
}): Promise<LicenseRow[]> {
  await ensureSchema();
  const tier = opts.tier || "pro";
  const deviceLimit =
    opts.deviceLimit && opts.deviceLimit > 0 ? Math.trunc(opts.deviceLimit) : 3;
  const expires =
    opts.expiryDays && opts.expiryDays > 0
      ? new Date(Date.now() + opts.expiryDays * 86400000).toISOString()
      : null;
  const out: LicenseRow[] = [];
  for (let i = 0; i < opts.count; i++) {
    let inserted: LicenseRow | null = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const key = randLicenseKey();
      const { rows } = await getPool().query<LicenseRow>(
        `INSERT INTO app_licenses (key, tier, device_limit, expires_at, batch, note)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (key) DO NOTHING
         RETURNING key, tier, status, device_limit, expires_at, batch, note, bound_email, created_at`,
        [key, tier, deviceLimit, expires, opts.batch, opts.note]
      );
      if (rows[0]) inserted = rows[0];
    }
    if (inserted) out.push(inserted);
  }
  return out;
}

/** 列出 License(最近 500,含当前已激活设备数)。 */
export async function listLicenses(): Promise<
  (LicenseRow & { activations: number })[]
> {
  await ensureSchema();
  const { rows } = await getPool().query<LicenseRow & { activations: string }>(
    `SELECT l.key, l.tier, l.status, l.device_limit, l.expires_at, l.batch, l.note,
            l.bound_email, l.created_at,
            (SELECT COUNT(*) FROM app_license_activations a
              WHERE a.license_key = l.key AND a.active) AS activations
       FROM app_licenses l ORDER BY l.created_at DESC LIMIT 500`
  );
  return rows.map((r) => ({ ...r, activations: Number(r.activations ?? 0) }));
}

/** License 统计(站长后台卡片)。 */
export async function licenseStats(): Promise<{
  issued: number;
  active: number;
  revoked: number;
  activations: number;
}> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    issued: string;
    active: string;
    revoked: string;
    activations: string;
  }>(
    `SELECT COUNT(*) AS issued,
            COUNT(*) FILTER (WHERE status = 'active') AS active,
            COUNT(*) FILTER (WHERE status = 'revoked') AS revoked,
            (SELECT COUNT(*) FROM app_license_activations WHERE active) AS activations
       FROM app_licenses`
  );
  const r = rows[0];
  return {
    issued: Number(r?.issued ?? 0),
    active: Number(r?.active ?? 0),
    revoked: Number(r?.revoked ?? 0),
    activations: Number(r?.activations ?? 0),
  };
}

/** 启用 / 吊销 License。 */
export async function setLicenseStatus(
  keyRaw: string,
  status: "active" | "revoked"
): Promise<void> {
  await ensureSchema();
  await getPool().query(`UPDATE app_licenses SET status = $2 WHERE key = $1`, [
    keyRaw.trim().toUpperCase(),
    status,
  ]);
}

type LicenseOk = { row: LicenseRow };
async function loadLicense(
  keyRaw: string
): Promise<LicenseOk | { error: string }> {
  const key = keyRaw.trim().toUpperCase();
  if (!key) return { error: "请填写 License Key" };
  const { rows } = await getPool().query<LicenseRow>(
    `SELECT key, tier, status, device_limit, expires_at, batch, note, bound_email, created_at
       FROM app_licenses WHERE key = $1`,
    [key]
  );
  const row = rows[0];
  if (!row) return { error: "License Key 不存在" };
  if (row.status === "revoked") return { error: "License 已被吊销" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())
    return { error: "License 已过期" };
  return { row };
}

/** 校验 License(发货弹窗用)。 */
export async function validateLicense(
  keyRaw: string
): Promise<
  | { ok: true; key: string; tier: string; expiresAt: string | null }
  | { ok: false; error: string }
> {
  await ensureSchema();
  const st = await loadLicense(keyRaw);
  if ("error" in st) return { ok: false, error: st.error };
  return {
    ok: true,
    key: st.row.key,
    tier: st.row.tier,
    expiresAt: st.row.expires_at
      ? new Date(st.row.expires_at).toISOString()
      : null,
  };
}

/** 激活(Pro 实例调用):校验 + 绑定 host + 设备数上限。 */
export async function activateLicense(
  keyRaw: string,
  hostRaw: string
): Promise<
  | {
      ok: true;
      tier: string;
      expiresAt: string | null;
      deviceLimit: number;
      activatedDevices: number;
    }
  | { ok: false; error: string }
> {
  await ensureSchema();
  const st = await loadLicense(keyRaw);
  if ("error" in st) return { ok: false, error: st.error };
  const key = st.row.key;
  const host = hostRaw.trim().toLowerCase().slice(0, 200);
  if (!host) return { ok: false, error: "缺少部署标识 host" };

  const { rows: exist } = await getPool().query<{ id: number }>(
    `SELECT id FROM app_license_activations WHERE license_key = $1 AND host = $2`,
    [key, host]
  );
  if (exist[0]) {
    await getPool().query(
      `UPDATE app_license_activations SET active = true, last_seen = now()
        WHERE license_key = $1 AND host = $2`,
      [key, host]
    );
  } else {
    const { rows: cnt } = await getPool().query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM app_license_activations WHERE license_key = $1 AND active`,
      [key]
    );
    if (Number(cnt[0]?.n ?? 0) >= st.row.device_limit) {
      return { ok: false, error: `已达设备数上限(${st.row.device_limit})` };
    }
    await getPool().query(
      `INSERT INTO app_license_activations (license_key, host) VALUES ($1,$2)
       ON CONFLICT (license_key, host) DO UPDATE SET active = true, last_seen = now()`,
      [key, host]
    );
  }
  const { rows: cnt2 } = await getPool().query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM app_license_activations WHERE license_key = $1 AND active`,
    [key]
  );
  return {
    ok: true,
    tier: st.row.tier,
    expiresAt: st.row.expires_at
      ? new Date(st.row.expires_at).toISOString()
      : null,
    deviceLimit: st.row.device_limit,
    activatedDevices: Number(cnt2[0]?.n ?? 0),
  };
}

/** 某 License 的已绑定部署(我的授权页)。 */
export async function licenseActivations(
  keyRaw: string
): Promise<
  { host: string; active: boolean; activatedAt: string; lastSeen: string }[]
> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    host: string;
    active: boolean;
    activated_at: Date;
    last_seen: Date;
  }>(
    `SELECT host, active, activated_at, last_seen FROM app_license_activations
      WHERE license_key = $1 ORDER BY activated_at DESC`,
    [keyRaw.trim().toUpperCase()]
  );
  return rows.map((r) => ({
    host: r.host,
    active: r.active,
    activatedAt: new Date(r.activated_at).toISOString(),
    lastSeen: new Date(r.last_seen).toISOString(),
  }));
}

type UserRow = {
  email: string;
  name: string;
  plan: string;
  credits_total: number;
  credits_used: number;
  joined_at: Date;
  renews_at: Date;
};

async function invoicesFor(email: string): Promise<Invoice[]> {
  const { rows } = await getPool().query(
    `SELECT id, created_at, plan, amount, status
       FROM app_invoices WHERE email = $1 ORDER BY created_at DESC`,
    [email]
  );
  return rows.map((r) => ({
    id: r.id,
    date: new Date(r.created_at).toISOString(),
    plan: r.plan,
    amount: r.amount,
    status: "paid" as const,
  }));
}

// 累计充值(分):已支付订单金额之和。用于「高阶」出图模式解锁(≥999元=99900分)。
export const HIGH_QUALITY_MIN_PAID_CENTS = 99900;
export async function totalPaidCents(emailRaw: string): Promise<number> {
  const { rows } = await getPool().query<{ s: string }>(
    `SELECT COALESCE(SUM(amount),0)::bigint AS s
       FROM app_orders WHERE email = $1 AND status = 'paid'`,
    [emailRaw.toLowerCase()]
  );
  return Number(rows[0]?.s ?? 0);
}

async function toSessionUser(row: UserRow): Promise<SessionUser> {
  // creditsTotal = 活批次余额(顺带跑过期 + 同步镜像);creditsUsed = 在途占位。
  // remaining = creditsTotal - creditsUsed 对所有现有读取点继续成立。
  const creditsTotal = await refreshBalance(row.email);
  return {
    name: row.name,
    email: row.email,
    plan: row.plan as PlanKey,
    creditsTotal,
    creditsUsed: row.credits_used,
    joinedAt: new Date(row.joined_at).toISOString(),
    renewsAt: new Date(row.renews_at).toISOString(),
    invoices: await invoicesFor(row.email),
    unmetered: await creditsExempt(row.email).catch(() => false),
  };
}

// 新用户注册赠送积分(后台可配)。默认 30;设为 0 则不赠送。30 天有效。
const SIGNUP_BONUS_KEY = "signup_bonus_credits";
const SIGNUP_BONUS_DEFAULT = 30;

/** 读「新用户注册赠送积分数」(后台设置优先,默认 30)。 */
export async function getSignupBonus(): Promise<number> {
  try {
    const v = await getSetting(SIGNUP_BONUS_KEY);
    if (v != null && v !== "") {
      const n = Math.trunc(Number(v));
      if (Number.isFinite(n) && n >= 0) return Math.min(n, 100000);
    }
  } catch {
    /* 读失败回退默认 */
  }
  return SIGNUP_BONUS_DEFAULT;
}

/** 后台保存「新用户注册赠送积分数」(夹取 0..100000)。 */
export async function setSignupBonus(n: number): Promise<void> {
  const safe = Math.min(Math.max(0, Math.trunc(n)), 100000);
  await setSetting(SIGNUP_BONUS_KEY, String(safe));
}

export async function getOrCreateUser(
  emailRaw: string,
  name?: string
): Promise<SessionUser> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  // 首次创建余额从 0 起,靠下面的「新人赠送」批次设额度;老用户(冲突)不补发。
  // xmax=0 表示本语句是 INSERT(新行)而非 ON CONFLICT 的 UPDATE。
  const { rows } = await getPool().query<UserRow & { is_new: boolean }>(
    `INSERT INTO app_users (email, name, plan, credits_total, credits_used, renews_at)
       VALUES ($1, $2, 'starter', 0, 0, $3)
     ON CONFLICT (email) DO UPDATE
       SET name = CASE WHEN $2 <> '' THEN $2 ELSE app_users.name END
     RETURNING *, (xmax = 0) AS is_new`,
    [email, name ?? "", oneMonthFromNowISO()]
  );
  if (rows[0]?.is_new) {
    const bonus = await getSignupBonus(); // 后台可配,默认 30;0=不赠送
    // 新人赠送同样是**从站点库存划拨**,库存不足就不送(而不是凭空产生)。
    // 这是四个发放入口之一,少堵一个站长就能绕过站点配额。
    const { reserveIssue } = await import("@/lib/credit-issue");
    const stock = bonus > 0 ? await reserveIssue(bonus) : { ok: true as const };
    if (bonus > 0 && stock.ok) {
      const d = new Date();
      d.setDate(d.getDate() + 30); // 新人赠送:30 天有效
      await addCreditBatch(email, bonus, {
        source: "grant",
        reason: "新人赠送",
        expiresAt: d,
        ledgerKind: "grant",
      }).catch(() => {});
    }
  }
  return toSessionUser(rows[0]);
}

// --- 原生多用户:密码存取(Pro 多用户模式,不依赖 Supabase) ---
export async function setUserPassword(
  emailRaw: string,
  hash: string
): Promise<void> {
  await ensureSchema();
  await getPool().query(`UPDATE app_users SET password_hash = $2 WHERE email = $1`, [
    emailRaw.toLowerCase(),
    hash,
  ]);
}

export async function getUserPasswordHash(
  emailRaw: string
): Promise<string | null> {
  await ensureSchema();
  const { rows } = await getPool().query<{ password_hash: string | null }>(
    `SELECT password_hash FROM app_users WHERE email = $1`,
    [emailRaw.toLowerCase()]
  );
  return rows[0]?.password_hash ?? null;
}

export async function userExists(emailRaw: string): Promise<boolean> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT 1 FROM app_users WHERE email = $1`,
    [emailRaw.toLowerCase()]
  );
  return rows.length > 0;
}

export async function getUser(
  emailRaw: string
): Promise<SessionUser | null> {
  await ensureSchema();
  const { rows } = await getPool().query<UserRow>(
    `SELECT * FROM app_users WHERE email = $1`,
    [emailRaw.toLowerCase()]
  );
  return rows[0] ? toSessionUser(rows[0]) : null;
}

// 月度会员已下线:本函数只改 plan 标签(后台仍可设),不再动积分/到期/开账单。
// 积分一律走批次(addCreditBatch / fulfillOrder)。
export async function changeUserPlan(
  emailRaw: string,
  planKey: PlanKey
): Promise<{ user: SessionUser; invoice: Invoice | null }> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  const { rows } = await getPool().query<UserRow>(
    `UPDATE app_users SET plan = $2 WHERE email = $1 RETURNING *`,
    [email, planKey]
  );
  if (!rows[0]) throw new Error("用户不存在");
  return { user: await toSessionUser(rows[0]), invoice: null };
}

// --- Admin: user & membership management ---------------------------------

export type AdminUserRow = {
  email: string;
  name: string;
  plan: string;
  role: string;
  creditsTotal: number;
  creditsUsed: number;
  artworks: number;
  banned: boolean;
  lastIp: string | null;
  recent7: number; // 近 7 天消耗积分（生成图数 × 单价）
  note: string; // 管理员备注（仅后台可见）
};

export async function listAllUsers(): Promise<AdminUserRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT u.email, u.name, u.plan, u.role,
            u.credits_total, u.credits_used, u.banned, u.last_ip, u.note,
            (SELECT count(*) FROM app_artworks a WHERE a.email = u.email)
              AS artworks,
            (SELECT count(*) FROM app_artworks a
               WHERE a.email = u.email
                 AND a.created_at > now() - interval '7 days')
              AS artworks7d
       FROM app_users u
      ORDER BY artworks7d DESC, u.joined_at ASC`
  );
  return rows.map((r) => ({
    email: r.email,
    name: r.name,
    plan: r.plan,
    role: r.role,
    creditsTotal: r.credits_total,
    creditsUsed: r.credits_used,
    artworks: Number(r.artworks),
    banned: r.banned === true,
    lastIp: r.last_ip ?? null,
    recent7: Number(r.artworks7d) * POINTS_PER_IMAGE,
    note: r.note ?? "",
  }));
}

export async function adminStats(): Promise<{
  users: number;
  artworks: number;
  remaining: number;
  used: number;
}> {
  await ensureSchema();
  const a = await getPool().query(
    `SELECT count(*)::int AS users,
            COALESCE(sum(credits_total - credits_used),0)::int AS remaining,
            COALESCE(sum(credits_used),0)::int AS used
       FROM app_users`
  );
  const b = await getPool().query(
    `SELECT count(*)::int AS artworks FROM app_artworks`
  );
  return {
    users: a.rows[0].users,
    remaining: a.rows[0].remaining,
    used: a.rows[0].used,
    artworks: b.rows[0].artworks,
  };
}

export async function setUserRole(
  emailRaw: string,
  role: string
): Promise<void> {
  await ensureSchema();
  const r = role === "admin" ? "admin" : "user";
  await getPool().query(
    `UPDATE app_users SET role = $2 WHERE email = $1`,
    [emailRaw.toLowerCase(), r]
  );
}

export async function getUserRole(emailRaw: string): Promise<string | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT role FROM app_users WHERE email = $1`,
    [emailRaw.toLowerCase()]
  );
  return (rows[0]?.role as string | undefined) ?? null;
}

/** 当前站长邮箱账号(role=admin 且非内部 operator 合成邮箱);未设置返回 null。 */
export async function getOwnerEmail(): Promise<string | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT email FROM app_users
      WHERE role = 'admin' AND email <> 'operator@novaryns.local'
      ORDER BY joined_at ASC LIMIT 1`
  );
  return (rows[0]?.email as string | undefined) ?? null;
}

/**
 * 设置「站长邮箱账号」:把 oldEmail(通常是 operator@novaryns.local)名下的
 * **全部数据整体迁移**到 newEmail(积分/作品/流水/订单等,凡带 email 列的 app_ 表
 * 动态发现、事务内一并改名),并设 role=admin + 登录密码。
 * 之后站长即可在普通登录框用邮箱+密码登录,与官方站体验一致。
 */
export async function setOwnerAccount(
  oldEmailRaw: string,
  newEmailRaw: string,
  passwordHash: string
): Promise<void> {
  await ensureSchema();
  const oldEmail = oldEmailRaw.toLowerCase();
  const newEmail = newEmailRaw.toLowerCase();
  if (oldEmail === newEmail) throw new Error("新旧邮箱相同");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const dup = await client.query(`SELECT 1 FROM app_users WHERE email = $1`, [
      newEmail,
    ]);
    if (dup.rows.length) {
      throw new Error("该邮箱已被注册,请换一个邮箱");
    }
    // 动态发现所有带 email 列的业务表,整体改名(以后新表加 email 列也自动覆盖)。
    const tables = await client.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'email'
          AND table_name LIKE 'app\\_%'`
    );
    for (const r of tables.rows as { table_name: string }[]) {
      await client.query(
        `UPDATE "${r.table_name}" SET email = $2 WHERE email = $1`,
        [oldEmail, newEmail]
      );
    }
    // operator 从没建过行(极早期实例)→ 直接建一行。
    const has = await client.query(`SELECT 1 FROM app_users WHERE email = $1`, [
      newEmail,
    ]);
    if (!has.rows.length) {
      await client.query(
        `INSERT INTO app_users (email, name, plan, credits_total, credits_used, renews_at)
           VALUES ($1, $2, 'starter', 0, 0, now() + interval '1 month')`,
        [newEmail, newEmail.split("@")[0]]
      );
    }
    await client.query(
      `UPDATE app_users SET role = 'admin', password_hash = $2, name = COALESCE(NULLIF(name,''), $3) WHERE email = $1`,
      [newEmail, passwordHash, "站长"]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// 后台手动调积分:正数 = 新建一个赠送批次(获取),有效期可按月设置(opts.months;
// 0 或负 = 永久,缺省 = 24 个月);负数 = FIFO 扣本金 + 记消耗流水(不动在途占位)。
export async function adjustUserCredits(
  emailRaw: string,
  delta: number,
  reason: string,
  opts: { months?: number } = {}
): Promise<void> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  if (delta === 0) return;
  if (delta > 0) {
    const m = opts.months;
    const expiresAt = new Date();
    if (m === undefined || m === null) {
      expiresAt.setFullYear(expiresAt.getFullYear() + 2); // 兜底 2 年
    } else if (m <= 0) {
      expiresAt.setFullYear(expiresAt.getFullYear() + 100); // 永久(远期)
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + Math.trunc(m));
    }
    await addCreditBatch(email, delta, {
      source: "admin",
      reason,
      ledgerKind: "grant",
      expiresAt,
    });
    return;
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await deductPrincipalFIFO(client, email, -delta);
    await client.query(
      `INSERT INTO app_ledger (id, email, delta, reason, kind) VALUES ($1,$2,$3,$4,'consume')`,
      [ledId(), email, delta, reason]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await refreshBalance(email).catch(() => {});
}

export type LedgerRow = {
  id: string;
  email: string;
  delta: number;
  reason: string;
  kind: string;
  expiresAt: string | null;
  createdAt: string;
};

function mapLedger(r: {
  id: string;
  email: string;
  delta: number;
  reason: string;
  kind?: string | null;
  expires_at?: Date | null;
  created_at: Date;
}): LedgerRow {
  return {
    id: r.id,
    email: r.email,
    delta: r.delta,
    reason: r.reason,
    kind: r.kind ?? "",
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listLedger(limit = 20): Promise<LedgerRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, email, delta, reason, kind, expires_at, created_at
       FROM app_ledger ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(mapLedger);
}

/** 结算/审计流水。delta<0 = 消费结算:FIFO 扣本金 + 释放在途占位
 *  (credits_used += delta)+ 记 consume 流水 + 同步余额(这是三个消费路由成功后
 *  调用的扣费入口,签名不变所以路由无需改)。delta>0 走纯审计兜底(目前无调用方)。 */
export async function addLedgerEntry(
  emailRaw: string,
  delta: number,
  reason: string,
  /** 关联的生成批次(app_artworks.batch_id),让账户页的明细能点回那几张图。 */
  refId?: string
): Promise<void> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  if (delta < 0 && (await creditsExempt(email))) return; // 不计积分的人不扣(见 creditsExempt)
  if (delta < 0) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await deductPrincipalFIFO(client, email, -delta);
      await client.query(
        `UPDATE app_users SET credits_used = GREATEST(credits_used + $2, 0) WHERE email = $1`,
        [email, delta]
      );
      await client.query(
        `INSERT INTO app_ledger (id, email, delta, reason, kind, ref_id) VALUES ($1,$2,$3,$4,'consume',$5)`,
        [ledId(), email, delta, reason, refId ?? null]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    await refreshBalance(email).catch(() => {});
    return;
  }
  await getPool().query(
    `INSERT INTO app_ledger (id, email, delta, reason, kind, ref_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [ledId(), email, delta, reason, delta > 0 ? "grant" : "consume", refId ?? null]
  );
}

/** Per-user credit ledger — for the admin member detail view. */
export async function listUserLedger(
  emailRaw: string,
  limit = 100
): Promise<LedgerRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, email, delta, reason, kind, expires_at, created_at, ref_id
       FROM app_ledger WHERE email = $1
      ORDER BY created_at DESC LIMIT $2`,
    [emailRaw.toLowerCase(), limit]
  );
  return rows.map(mapLedger);
}

/** 用户端「积分明细」:按类别(all/purchase/consume/grant/refund/expire)筛选,
 *  默认仅 30 天内。先跑过期确保过期流水已生成。 */
export async function listUserLedgerFiltered(
  emailRaw: string,
  opts: { kind?: string; sinceDays?: number; limit?: number } = {}
): Promise<LedgerRow[]> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  await expireDueBatches(email);
  const limit = Math.min(opts.limit ?? 200, 500);
  const days = String(opts.sinceDays ?? 30);
  const params: unknown[] = [email, days, limit];
  let kindClause = "";
  if (opts.kind && opts.kind !== "all") {
    params.push(opts.kind);
    kindClause = ` AND kind = $4`;
  }
  const { rows } = await getPool().query(
    `SELECT id, email, delta, reason, kind, expires_at, created_at
       FROM app_ledger
      WHERE email = $1
        AND created_at >= now() - ($2 || ' days')::interval
        ${kindClause}
      ORDER BY created_at DESC LIMIT $3`,
    params
  );
  return rows.map(mapLedger);
}

/** 用户端积分概览:余额 + 最近一笔将到期的批次(给账户页头部用)。 */
export async function getCreditOverview(
  emailRaw: string
): Promise<{ balance: number; nextExpiry: { amount: number; at: string } | null }> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  const balance = await refreshBalance(email);
  const { rows } = await getPool().query(
    `SELECT remaining, expires_at FROM app_credit_batches
      WHERE email = $1 AND expires_at > now() AND remaining > 0
      ORDER BY expires_at ASC LIMIT 1`,
    [email]
  );
  const next = rows[0]
    ? { amount: rows[0].remaining as number, at: new Date(rows[0].expires_at).toISOString() }
    : null;
  return { balance, nextExpiry: next };
}

// --- Admin: ban / delete / login-IP --------------------------------------

export async function deleteUser(emailRaw: string): Promise<void> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // app_invoices cascades via FK; artworks/ledger have no FK -> clean up.
    await client.query(`DELETE FROM app_artworks WHERE email = $1`, [email]);
    await client.query(`DELETE FROM app_ledger WHERE email = $1`, [email]);
    await client.query(`DELETE FROM app_users WHERE email = $1`, [email]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function setUserBanned(
  emailRaw: string,
  banned: boolean
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE app_users SET banned = $2 WHERE email = $1`,
    [emailRaw.toLowerCase(), banned]
  );
}

// 管理员备注:仅后台可见,纯文本(上限 1000 字防滥用)。
export async function setUserNote(
  emailRaw: string,
  note: string
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE app_users SET note = $2 WHERE email = $1`,
    [emailRaw.toLowerCase(), note.slice(0, 1000)]
  );
}

/** Given a set of emails, returns the subset currently banned. */
export async function bannedEmailsAmong(emails: string[]): Promise<string[]> {
  await ensureSchema();
  if (emails.length === 0) return [];
  const lowered = Array.from(new Set(emails.map((e) => e.toLowerCase())));
  const { rows } = await getPool().query(
    `SELECT email FROM app_users WHERE banned = true AND email = ANY($1)`,
    [lowered]
  );
  return rows.map((r) => r.email as string);
}

// --- Orders / payments ----------------------------------------------------

export type OrderRow = {
  id: string;
  email: string;
  kind: string; // 'plan' | 'pack'
  itemId: string;
  title: string;
  credits: number;
  amount: number; // 分 (RMB cents)
  status: string; // pending|paid|failed|expired
  provider: string;
  providerTxn: string | null;
  createdAt: string;
  paidAt: string | null;
};

type OrderDbRow = {
  id: string;
  email: string;
  kind: string;
  item_id: string;
  title: string;
  credits: number;
  amount: number;
  status: string;
  provider: string;
  provider_txn: string | null;
  created_at: Date;
  paid_at: Date | null;
};

function rowToOrder(r: OrderDbRow): OrderRow {
  return {
    id: r.id,
    email: r.email,
    kind: r.kind,
    itemId: r.item_id,
    title: r.title,
    credits: r.credits,
    amount: r.amount,
    status: r.status,
    provider: r.provider,
    providerTxn: r.provider_txn ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
  };
}

export async function createOrder(o: {
  email: string;
  kind: string;
  itemId: string;
  title: string;
  credits: number;
  amount: number;
}): Promise<OrderRow> {
  await ensureSchema();
  const id = `ord-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { rows } = await getPool().query<OrderDbRow>(
    `INSERT INTO app_orders
       (id, email, kind, item_id, title, credits, amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
    [id, o.email.toLowerCase(), o.kind, o.itemId, o.title, o.credits, o.amount]
  );
  return rowToOrder(rows[0]);
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  await ensureSchema();
  const { rows } = await getPool().query<OrderDbRow>(
    `SELECT * FROM app_orders WHERE id = $1`,
    [id]
  );
  return rows[0] ? rowToOrder(rows[0]) : null;
}

/** Marks an order paid and grants the entitlement, atomically + idempotently.
 *  Re-calling on an already-paid order is a no-op (no double credit). */
export async function fulfillOrder(
  orderId: string,
  provider: string,
  providerTxn?: string | null
): Promise<{ ok: boolean; alreadyPaid: boolean; order?: OrderRow; error?: string }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<OrderDbRow>(
      `SELECT * FROM app_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const o = rows[0];
    if (!o) {
      await client.query("ROLLBACK");
      return { ok: false, alreadyPaid: false, error: "订单不存在" };
    }
    if (o.status === "paid") {
      await client.query("COMMIT");
      return { ok: true, alreadyPaid: true, order: rowToOrder(o) };
    }
    // Pro 授权 / 云端托管 / 算力包订单:不发站内积分,标记已付后在事务外兑现
    // (Pro→License;cloud→开实例;compute→给中转 token 充配额,均按 orderId 幂等)。
    if (o.kind !== "pro" && o.kind !== "cloud" && o.kind !== "compute") {
      // 用户买积分到账 —— 这也是**从站点库存划拨**,必须记进 issued_total。
      //
      // ⚠️ **但这里的处理跟其他三个入口不同**:钱已经收了(支付回调走到这一步说明
      // 用户付款成功),**绝不能因为库存不足就不给积分** —— 那是收了钱不发货。
      // 所以这里只"记账不拦截":照常入账,同时把 issued_total 顶上去(哪怕超过
      // quota_total)。超发的部分会让站长后台的「可发放」变成 0,逼他去补充算力,
      // 而不是让付了钱的终端用户受损。
      // 站长该做的是**保证库存充足再开卖**,这属于经营责任,不该由用户承担。
      const reason = `购买${o.title || "积分"}`;
      const expISO = twoYearsFromNow().toISOString();
      await client.query(
        `INSERT INTO app_credit_batches
           (id, email, amount, remaining, source, reason, order_id, expires_at)
         VALUES ($1,$2,$3,$3,'purchase',$4,$5,$6)`,
        [ledId("bat"), o.email, o.credits, reason, o.id, expISO]
      );
      await client.query(
        `INSERT INTO app_ledger (id, email, delta, reason, kind, expires_at)
           VALUES ($1,$2,$3,$4,'purchase',$5)`,
        [ledId(), o.email, o.credits, reason, expISO]
      );
      await client.query(
        `UPDATE app_users SET credits_total = (
           SELECT COALESCE(SUM(remaining),0) FROM app_credit_batches
            WHERE email = $1 AND expires_at > now() AND remaining > 0)
          WHERE email = $1`,
        [o.email]
      );
    }
    await client.query(
      `UPDATE app_orders SET status='paid', provider=$2, provider_txn=$3,
          paid_at=now() WHERE id=$1`,
      [orderId, provider, providerTxn ?? null]
    );
    await client.query("COMMIT");
    // 事务外记账:用户买的积分计入「已发放」。**放事务外**是因为 relay 是外部 HTTP 服务,
    // 把它放进事务里会让数据库连接被网络往返卡住,失败还会连累已经成功的入账。
    // 记账失败不影响用户拿到积分(下次对账能发现差额)。
    if (o.kind !== "pro" && o.kind !== "cloud" && o.kind !== "compute" && o.credits > 0) {
      void import("@/lib/credit-issue")
        .then((m) => m.reserveIssue(o.credits))
        .catch(() => {});
      // 邀请有奖:被邀请人第一次在线充值 → 给邀请人发首充奖励(幂等;兑换码/后台加分不走这里)
      void rewardInviteRecharge(o.email).catch(() => {});
    }
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const updated = await getOrder(orderId);
  // Pro 直售:付款落定后幂等生成授权(失败不影响订单已付;轮询接口会懒补)。
  if (updated?.kind === "pro") {
    await ensureProLicenseForOrder(updated.id, updated.email).catch(() => null);
  }
  // 云端托管:付款落定后开通实例。开通耗时数分钟,不阻塞支付回调 —— fire-and-forget
  // 后台跑;前端 /api/cloud/provision(等待式)与 M4 定时任务是可靠兜底(均按 orderId 幂等)。
  if (updated?.kind === "cloud") {
    void ensureCloudTenantForOrder(updated.id, updated.email, updated.itemId).catch(() => null);
  }
  // 算力包:给对应中转 token 充积分(秒级,轮询接口也会懒补兜底)。
  if (updated?.kind === "compute") {
    await ensureComputeTopupForOrder(updated.id, updated.itemId).catch(() => null);
  }
  return { ok: true, alreadyPaid: false, order: updated ?? undefined };
}

// 算力包兑现:已付 compute 订单 → 给中转 token addQuota(积分)。幂等:app_compute_topups
// 按 order_id 原子认领(pending/failed 可重试,applied 直接返回),避免回调+轮询双触发重复充值。
export async function ensureComputeTopupForOrder(
  orderId: string,
  itemId: string
): Promise<{ ok: boolean; credits?: number; error?: string }> {
  await ensureSchema();
  const [packId, tokenId] = (itemId || "").split(":");
  const { findComputePack } = await import("@/lib/cloud");
  const pack = findComputePack(packId || "");
  if (!pack || !/^[0-9a-f]{16}$/.test(tokenId || "")) return { ok: false, error: "订单商品信息异常" };

  // 原子认领:无记录/failed/超时卡死的 pending(认领后进程崩溃)→ pending 占位并刷新
  // created_at(=认领时间);已 applied → 幂等返回成功。
  const claim = await getPool().query<{ status: string }>(
    `INSERT INTO app_compute_topups (order_id, token_id, credits, status)
       VALUES ($1,$2,$3,'pending')
     ON CONFLICT (order_id) DO UPDATE SET status='pending', error=NULL, created_at=now()
       WHERE app_compute_topups.status = 'failed'
          OR (app_compute_topups.status = 'pending'
              AND app_compute_topups.created_at < now() - interval '2 minutes')
     RETURNING status`,
    [orderId, tokenId, pack.credits]
  );
  if (!claim.rows[0]) {
    const cur = await getPool().query<{ status: string }>(
      `SELECT status FROM app_compute_topups WHERE order_id=$1`, [orderId]);
    if (cur.rows[0]?.status === "applied") return { ok: true, credits: pack.credits };
    return { ok: false, error: "充值正在处理中" }; // 别处已认领 pending
  }

  try {
    const { patchToken } = await import("@/lib/relay");
    await patchToken(tokenId, { addQuota: pack.credits });
    await getPool().query(
      `UPDATE app_compute_topups SET status='applied', applied_at=now() WHERE order_id=$1`, [orderId]);
    return { ok: true, credits: pack.credits };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "充值失败";
    await getPool().query(
      `UPDATE app_compute_topups SET status='failed', error=$2 WHERE order_id=$1`, [orderId, msg]);
    return { ok: false, error: msg };
  }
}

// Pro 直售订单 → License Key(幂等:batch=orderId 唯一)。付款回调与订单轮询
// 都会调它,先查后建;生成后绑定买家邮箱,可溯源可吊销。有效期 365 天。
export async function ensureProLicenseForOrder(
  orderId: string,
  emailRaw: string
): Promise<string | null> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  const { rows } = await getPool().query<{ key: string }>(
    `SELECT key FROM app_licenses WHERE batch = $1 LIMIT 1`,
    [orderId]
  );
  if (rows[0]) return rows[0].key;
  const [lic] = await generateLicenses({
    count: 1,
    tier: "pro",
    expiryDays: 365,
    batch: orderId,
    note: `官网直售 ${email}`,
  });
  if (!lic) return null;
  await getPool().query(
    `UPDATE app_licenses SET bound_email = $2 WHERE key = $1`,
    [lic.key, email]
  );
  return lic.key;
}

// ---------------------------------------------------------------------------
// 云端托管租户开通(见 docs/cloud-provisioning.md M3)。
// ---------------------------------------------------------------------------
export type CloudTenantRow = {
  orderId: string;
  email: string;
  subdomain: string;
  region: string;
  status: string; // pending|provisioning|active|failed|suspended|purged
  url: string | null;
  adminPassword: string | null;
  error: string | null;
  expiresAt: string | null;
  createdAt: string;
  provisionedAt: string | null;
  renewals: number;
  customDomains: string[];
};

type CloudTenantDbRow = {
  order_id: string;
  email: string;
  subdomain: string;
  region: string;
  status: string;
  url: string | null;
  admin_password: string | null;
  error: string | null;
  expires_at: Date | null;
  created_at: Date;
  provisioned_at: Date | null;
  renewals: number | null;
  custom_domains: string | null;
};

function rowToCloudTenant(r: CloudTenantDbRow): CloudTenantRow {
  return {
    orderId: r.order_id,
    email: r.email,
    subdomain: r.subdomain,
    region: r.region,
    status: r.status,
    url: r.url ?? null,
    adminPassword: r.admin_password ?? null,
    error: r.error ?? null,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    provisionedAt: r.provisioned_at ? new Date(r.provisioned_at).toISOString() : null,
    renewals: Number(r.renewals ?? 0),
    customDomains: (r.custom_domains || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export async function getCloudTenantByOrder(orderId: string): Promise<CloudTenantRow | null> {
  await ensureSchema();
  // 初次开通单命中 order_id;续费单命中 last_order_id —— 都解析到同一租户。
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `SELECT * FROM app_cloud_tenants WHERE order_id = $1 OR last_order_id = $1 LIMIT 1`,
    [orderId]
  );
  return rows[0] ? rowToCloudTenant(rows[0]) : null;
}

// 子域名是否被在途/活跃租户占用(check-name 用)。
export async function isCloudSubdomainTaken(subRaw: string): Promise<boolean> {
  await ensureSchema();
  const sub = normalizeSubdomain(subRaw);
  const { rows } = await getPool().query<{ order_id: string }>(
    `SELECT order_id FROM app_cloud_tenants
       WHERE subdomain = $1 AND status IN ('pending','provisioning','active','suspended') LIMIT 1`,
    [sub]
  );
  return !!rows[0];
}

export async function listCloudTenantsByEmail(emailRaw: string): Promise<CloudTenantRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `SELECT * FROM app_cloud_tenants WHERE email = $1 ORDER BY created_at DESC`,
    [emailRaw.toLowerCase()]
  );
  return rows.map(rowToCloudTenant);
}

async function markCloudFailed(orderId: string, email: string, sub: string, reason: string): Promise<CloudTenantRow | null> {
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `INSERT INTO app_cloud_tenants (order_id, email, subdomain, region, status, error, updated_at)
       VALUES ($1,$2,$3,'cn','failed',$4,now())
     ON CONFLICT (order_id) DO UPDATE SET status='failed', error=$4, updated_at=now()
     RETURNING *`,
    [orderId, email, sub, reason]
  );
  return rows[0] ? rowToCloudTenant(rows[0]) : null;
}

// 幂等开通:一个已付 cloud 订单 → 一个租户实例。付款回调(fire-and-forget)、前端
// /api/cloud/provision(等待式)、M4 定时兜底都会调它,靠 order_id 认领防重复开通。
export async function ensureCloudTenantForOrder(
  orderId: string,
  emailRaw: string,
  subdomainRaw: string
): Promise<CloudTenantRow | null> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  // itemId 形如 "<子域名>@<套餐id>";套餐决定有效期与赠送算力(月付30天/1000积分,年付365天/12000积分)。
  const { sub, plan } = parseCloudItemId(subdomainRaw);

  // 已存在且非 failed(provisioning/active/suspended)→ 不重复开,直接返回现状。
  const existing = await getCloudTenantByOrder(orderId);
  if (existing && existing.status !== "failed") return existing;

  // 续费:同一子域名 + 同一买家 已有 active/suspended 租户 → 本单是续费,延期(+1年)
  // 并在挂起时恢复,不新开实例。挂 last_order_id 让本续费单也能解析到该租户。
  const renew = await getPool().query<CloudTenantDbRow>(
    `SELECT * FROM app_cloud_tenants
       WHERE subdomain = $1 AND email = $2 AND order_id <> $3
         AND status IN ('active','suspended') LIMIT 1`,
    [sub, email, orderId]
  );
  if (renew.rows[0]) return renewCloudTenant(renew.rows[0], orderId, plan.days, plan.credits);

  // 子域名被「别的买家」在途/活跃占用 → 本单失败(建议客户换名或退款)。
  const taken = await getPool().query<{ order_id: string }>(
    `SELECT order_id FROM app_cloud_tenants
       WHERE subdomain = $1 AND order_id <> $2
         AND status IN ('pending','provisioning','active','suspended') LIMIT 1`,
    [sub, orderId]
  );
  if (taken.rows[0]) return markCloudFailed(orderId, email, sub, "子域名已被占用,请联系客服更换");

  // 原子认领:none/pending/failed → provisioning。抢不到(别的进程已在开)→ 返回现状。
  let claimed: CloudTenantRow | null = null;
  try {
    const { rows } = await getPool().query<CloudTenantDbRow>(
      `INSERT INTO app_cloud_tenants (order_id, email, subdomain, region, status, error, updated_at)
         VALUES ($1,$2,$3,'cn','provisioning',NULL,now())
       ON CONFLICT (order_id) DO UPDATE SET
         status='provisioning', email=EXCLUDED.email, subdomain=EXCLUDED.subdomain,
         error=NULL, updated_at=now()
         WHERE app_cloud_tenants.status IN ('pending','failed')
       RETURNING *`,
      [orderId, email, sub]
    );
    claimed = rows[0] ? rowToCloudTenant(rows[0]) : null;
  } catch {
    // 与 sub_live 唯一索引竞态(并发同名)→ 判为被占用。
    return markCloudFailed(orderId, email, sub, "子域名已被占用,请联系客服更换");
  }
  if (!claimed) return await getCloudTenantByOrder(orderId); // 没抢到 = 别处正在开

  if (!provisionerConfigured()) {
    return markCloudFailed(orderId, email, sub, "云端开通服务未配置,请联系客服");
  }

  // 调开通服务(阻塞,数分钟)。
  const res = await provisionTenant({ name: sub, email, site: sub, credits: plan.credits }).catch((e) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : "开通异常",
  }));

  if (!res.ok) {
    return markCloudFailed(orderId, email, sub, res.error || "开通失败");
  }

  // 有效期按套餐(月付 30 天 / 年付 365 天)。
  const expISO = new Date(Date.now() + plan.days * 86_400_000).toISOString();
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `UPDATE app_cloud_tenants
        SET status='active', url=$2, admin_password=$3, error=NULL,
            provisioned_at=now(), expires_at=$4, updated_at=now()
      WHERE order_id=$1 RETURNING *`,
    [orderId, res.url ?? `https://${cloudDomainFor(sub)}`, res.adminPassword ?? null, expISO]
  );
  const active = rows[0] ? rowToCloudTenant(rows[0]) : null;
  // 凭证邮件(best-effort,不影响开通结果)。
  void sendCloudCredentialsEmail(email, sub, active?.url ?? "", res.adminPassword ?? "").catch(() => {});
  return active;
}

async function sendCloudCredentialsEmail(email: string, sub: string, url: string, password: string): Promise<void> {
  if (!email || !url) return;
  const { sendMail } = await import("@/lib/mailer");
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">
      <h2 style="margin:0 0 12px">您的云端托管实例已开通</h2>
      <p>专属实例已就绪,可立即登录使用:</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">访问地址</td><td><a href="${url}">${url}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">管理员账号</td><td>${email}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">初始密码</td><td><code>${password}</code></td></tr>
      </table>
      <p style="color:#c00;font-size:13px">⚠️ 请首次登录后尽快修改初始密码。</p>
      <p style="color:#999;font-size:12px">子域名 ${sub}.starzeco.com</p>
    </div>`;
  await sendMail({ to: email, subject: "【星泽商图】您的云端托管实例已开通", html });
}

// 续费:按本次续费订单的套餐叠加时长(在剩余期上叠加,不因过期而缩水),挂起态则恢复实例。
async function renewCloudTenant(
  row: CloudTenantDbRow,
  renewalOrderId: string,
  renewDays: number,
  renewCredits: number
): Promise<CloudTenantRow | null> {
  const base = row.expires_at && new Date(row.expires_at).getTime() > Date.now()
    ? new Date(row.expires_at).getTime() : Date.now();
  const newExp = new Date(base + renewDays * 86_400_000).toISOString();
  // 挂起中 → 恢复实例(best-effort;失败也先记账,后台可重试 resume)。
  if (row.status === "suspended" && provisionerConfigured()) {
    await resumeTenant(row.subdomain).catch(() => ({ ok: false }));
  }
  // 补发本期算力(月付每月 1000 / 年付 12000)。不补的话月付客户续了费没积分可用。
  // 找该租户的 managed 中转 token 加配额;失败只记日志,不阻断续费(后台可手工充)。
  if (renewCredits > 0) {
    try {
      const { listTenants } = await import("@/lib/provisioner");
      const { patchToken } = await import("@/lib/relay");
      const reg = await listTenants();
      const rec = (reg.tenants as { name?: string; relayToken?: string }[] | undefined)?.find(
        (t) => t?.name === row.subdomain
      );
      if (rec?.relayToken) await patchToken(rec.relayToken, { addQuota: renewCredits });
    } catch (e) {
      console.error("[cloud] 续费补算力失败", row.subdomain, e instanceof Error ? e.message : e);
    }
  }
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `UPDATE app_cloud_tenants
        SET status='active', expires_at=$2, last_order_id=$3, renewed_at=now(),
            renewals=renewals+1, remind_sent_at=NULL, error=NULL, updated_at=now()
      WHERE order_id=$1 RETURNING *`,
    [row.order_id, newExp, renewalOrderId]
  );
  return rows[0] ? rowToCloudTenant(rows[0]) : null;
}

// ── M4 生命周期:到期扫描 + 后台管理动作 ──────────────────────────────────────

// 到期扫描:active 且 expires_at 已过 → 挂起(停容器 + 停用算力)。由 /api/cloud/lifecycle
// (CN ECS 每日 cron 调用)驱动。返回处理明细。
export async function sweepExpiredCloudTenants(): Promise<{ suspended: string[]; errors: string[] }> {
  await ensureSchema();
  const suspended: string[] = [];
  const errors: string[] = [];
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `SELECT * FROM app_cloud_tenants
       WHERE status='active' AND expires_at IS NOT NULL AND expires_at < now()`
  );
  if (!rows.length) return { suspended, errors };
  const { deprovisionTenant } = await import("@/lib/provisioner");
  for (const r of rows) {
    const res = await deprovisionTenant(r.subdomain, false).catch(() => ({ ok: false, error: "调用异常" }));
    if (res.ok) {
      await getPool().query(
        `UPDATE app_cloud_tenants SET status='suspended', updated_at=now() WHERE order_id=$1`,
        [r.order_id]
      );
      suspended.push(r.subdomain);
    } else {
      errors.push(`${r.subdomain}: ${res.error || "挂起失败"}`);
    }
  }
  return { suspended, errors };
}

// 到期前提醒:active 且 N 天内到期、尚未提醒过 → 发续费提醒邮件 + 标记 remind_sent_at。
// 续费后 renewCloudTenant 会清空 remind_sent_at,下一周期可再次提醒。默认提前 7 天。
export async function sweepCloudExpiryReminders(days = 7): Promise<{ reminded: string[] }> {
  await ensureSchema();
  const reminded: string[] = [];
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `SELECT * FROM app_cloud_tenants
       WHERE status='active' AND remind_sent_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at > now() AND expires_at < now() + ($1 || ' days')::interval`,
    [String(days)]
  );
  for (const r of rows) {
    const daysLeft = Math.ceil((new Date(r.expires_at as Date).getTime() - Date.now()) / 86_400_000);
    await sendCloudRenewalReminderEmail(r.email, r.subdomain, daysLeft, r.expires_at as Date).catch(() => {});
    await getPool().query(`UPDATE app_cloud_tenants SET remind_sent_at=now(), updated_at=now() WHERE order_id=$1`, [r.order_id]);
    reminded.push(r.subdomain);
  }
  return { reminded };
}

async function sendCloudRenewalReminderEmail(email: string, sub: string, daysLeft: number, expiresAt: Date): Promise<void> {
  if (!email) return;
  const { sendMail } = await import("@/lib/mailer");
  const dateStr = new Date(expiresAt).toLocaleDateString("zh-CN");
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">
      <h2 style="margin:0 0 12px">您的云端托管实例即将到期</h2>
      <p>实例 <b>${sub}.starzeco.com</b> 将于 <b>${dateStr}</b>(约 ${daysLeft} 天后)到期。</p>
      <p>到期后实例会自动暂停(数据保留);续费后立即恢复。请及时前往购买站续费以免影响使用。</p>
      <p style="margin-top:16px"><a href="https://ai.starzeco.com/deploy" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:14px">前往续费</a></p>
      <p style="color:#999;font-size:12px;margin-top:16px">如已续费请忽略本邮件。</p>
    </div>`;
  await sendMail({ to: email, subject: `【星泽商图】云端实例 ${sub}.starzeco.com 将于 ${daysLeft} 天后到期`, html });
}

export async function listAllCloudTenants(): Promise<CloudTenantRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `SELECT * FROM app_cloud_tenants ORDER BY created_at DESC`
  );
  return rows.map(rowToCloudTenant);
}

// 后台动作:suspend | resume | purge | retry(重试失败开通)| set-domain(绑/解自定义域)。按 subdomain 定位。
export async function cloudTenantAdminAction(
  subdomainRaw: string,
  action: "suspend" | "resume" | "purge" | "retry" | "set-domain",
  opts?: { domain?: string }
): Promise<{ ok: boolean; error?: string; warnings?: string[]; tenant?: CloudTenantRow | null }> {
  await ensureSchema();
  const sub = normalizeSubdomain(subdomainRaw);
  const { rows } = await getPool().query<CloudTenantDbRow>(
    `SELECT * FROM app_cloud_tenants WHERE subdomain=$1 ORDER BY created_at DESC LIMIT 1`,
    [sub]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "租户不存在" };
  if (!provisionerConfigured()) return { ok: false, error: "开通服务未配置" };
  const { deprovisionTenant, resumeTenant, setTenantDomains } = await import("@/lib/provisioner");

  if (action === "set-domain") {
    if (row.status !== "active") return { ok: false, error: "仅运行中的租户可绑定域名" };
    const domain = (opts?.domain || "").trim().toLowerCase();
    const domains = domain ? [domain] : []; // v1 单个域名;空 = 解绑
    const r = await setTenantDomains(sub, domains);
    if (r.ok) {
      await getPool().query(`UPDATE app_cloud_tenants SET custom_domains=$2, updated_at=now() WHERE order_id=$1`, [row.order_id, domains.join(",")]);
    }
    return { ok: r.ok, error: r.error, warnings: r.warnings, tenant: await getCloudTenantByOrder(row.order_id) };
  }

  if (action === "suspend") {
    const r = await deprovisionTenant(sub, false);
    if (r.ok) await getPool().query(`UPDATE app_cloud_tenants SET status='suspended', updated_at=now() WHERE order_id=$1`, [row.order_id]);
    return { ok: r.ok, error: r.error, tenant: await getCloudTenantByOrder(row.order_id) };
  }
  if (action === "resume") {
    const r = await resumeTenant(sub);
    if (r.ok) await getPool().query(`UPDATE app_cloud_tenants SET status='active', updated_at=now() WHERE order_id=$1`, [row.order_id]);
    return { ok: r.ok, error: r.error, tenant: await getCloudTenantByOrder(row.order_id) };
  }
  if (action === "purge") {
    const r = await deprovisionTenant(sub, true);
    if (r.ok) await getPool().query(`UPDATE app_cloud_tenants SET status='purged', updated_at=now() WHERE order_id=$1`, [row.order_id]);
    return { ok: r.ok, error: r.error, tenant: await getCloudTenantByOrder(row.order_id) };
  }
  // retry:仅对 failed 单重新开通(复位 status → ensureCloudTenantForOrder 重新认领)。
  if (row.status !== "failed") return { ok: false, error: "仅失败的租户可重试" };
  await getPool().query(`UPDATE app_cloud_tenants SET status='pending', error=NULL, updated_at=now() WHERE order_id=$1`, [row.order_id]);
  const t = await ensureCloudTenantForOrder(row.order_id, row.email, sub);
  return { ok: t?.status === "active", error: t?.error ?? undefined, tenant: t };
}

/** Best-effort: records the user's most recent login IP. Never throws. */
export async function recordLoginIp(
  emailRaw: string,
  ip: string | null
): Promise<void> {
  if (!ip) return;
  try {
    await ensureSchema();
    await getPool().query(
      `UPDATE app_users SET last_ip = $2, last_login_at = now() WHERE email = $1`,
      [emailRaw.toLowerCase(), ip]
    );
  } catch {
    /* IP tracking is non-critical — never block login on it */
  }
}

export type BannedIpRow = {
  ip: string;
  reason: string;
  createdAt: string;
};

export async function banIp(ip: string, reason = ""): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO app_banned_ips (ip, reason) VALUES ($1, $2)
     ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason`,
    [ip.trim(), reason]
  );
}

export async function unbanIp(ip: string): Promise<void> {
  await ensureSchema();
  await getPool().query(`DELETE FROM app_banned_ips WHERE ip = $1`, [
    ip.trim(),
  ]);
}

export async function listBannedIps(): Promise<BannedIpRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT ip, reason, created_at FROM app_banned_ips
      ORDER BY created_at DESC`
  );
  return rows.map((r) => ({
    ip: r.ip,
    reason: r.reason ?? "",
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** True when the account is banned OR the request IP is on the blocklist. */
export async function isBanned(
  emailRaw: string,
  ip: string | null
): Promise<boolean> {
  await ensureSchema();
  const email = emailRaw.trim().toLowerCase();
  if (email) {
    const u = await getPool().query(
      `SELECT 1 FROM app_users WHERE email = $1 AND banned = true`,
      [email]
    );
    if ((u.rowCount ?? 0) > 0) return true;
  }
  if (ip) {
    const b = await getPool().query(
      `SELECT 1 FROM app_banned_ips WHERE ip = $1`,
      [ip.trim()]
    );
    if ((b.rowCount ?? 0) > 0) return true;
  }
  return false;
}

/** 原子预扣占位:credits_used += n,门槛 = 活批次余额 - 已占位 >= n。
 *  本金不在此刻扣,真正扣减发生在结算(addLedgerEntry 负数)。余额不足返回 false。 */
/**
 * 这个人出图**不计积分**吗?(预扣 / 退款 / 实扣 / 前端拦截 统一用这一个口径)
 *
 *   · 官方云(Supabase):人人计费。
 *   · 自托管且站长手动开了「积分计费」:人人计费(站长自己要用量控制)。
 *   · 自托管开了多用户:**站长不计**,其他用户计费 —— 站长花的是自己的中转/Key 额度,
 *     再扣站内积分没意义,还会出现「站长积分用完自己的站出不了图」。
 *   · 自托管单人模式(没开计费):不计。
 *
 * 2026-10-19 首个商业版客户实测踩到:开多用户后站长被积分卡住;
 * 单人模式下前端仍按余额拦截(开源版 30 分用完就卡死)也是同一处没统一口径。
 */
export async function creditsExempt(emailRaw: string): Promise<boolean> {
  const { supabaseEnabled } = await import("@/lib/auth-mode");
  if (supabaseEnabled) return false;
  const { multiUserEnabled, creditsMeteringOn } = await import("@/lib/native-auth");
  if (await creditsMeteringOn()) return false;
  if (!(await multiUserEnabled())) return true;
  const email = emailRaw.toLowerCase();
  if (email === "operator@novaryns.local") return true; // 管理员密码登录的站长(lib/operator)
  try {
    return (await getUserRole(email)) === "admin";
  } catch {
    return false;
  }
}

export async function reserveCredits(
  emailRaw: string,
  n: number
): Promise<boolean> {
  // 是否计费:①Supabase 多用户(官方云)②原生多用户 ③站长手动开的「积分计费」开关
  //(单用户也可开来给自己/他人做用量控制)。三者任一为真则扣分,否则放行(不扣)。
  // 动态 import 避免静态循环。
  const email = emailRaw.toLowerCase();
  if (await creditsExempt(email)) return true; // 不计积分(见 creditsExempt)→ 放行
  await ensureSchema();
  if (n <= 0) return true;
  await expireDueBatches(email);
  const { rowCount } = await getPool().query(
    `UPDATE app_users u
        SET credits_used = credits_used + $2
      WHERE u.email = $1
        AND (SELECT COALESCE(SUM(remaining),0) FROM app_credit_batches b
              WHERE b.email = u.email AND b.expires_at > now() AND b.remaining > 0)
            - u.credits_used >= $2`,
    [email, n]
  );
  return (rowCount ?? 0) > 0;
}

export async function refundCredits(
  emailRaw: string,
  n: number
): Promise<void> {
  // 与 reserveCredits 放行口径一致:不计积分的人无需退款。
  if (await creditsExempt(emailRaw.toLowerCase())) return;
  await ensureSchema();
  await getPool().query(
    `UPDATE app_users
        SET credits_used = GREATEST(credits_used - $2, 0)
      WHERE email = $1`,
    [emailRaw.toLowerCase(), n]
  );
}

// --- Generation credit reservations (auto-refund safety net) --------------
// A row is written when a generation reserves credits, and deleted when the
// job settles (success or handled failure). If the process is killed mid-job
// (e.g. a deploy), the row is orphaned; sweepStaleReservations refunds those.

export async function addReservation(
  jobId: string,
  emailRaw: string,
  cost: number
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO app_gen_reservations (job_id, email, cost)
       VALUES ($1, $2, $3) ON CONFLICT (job_id) DO NOTHING`,
    [jobId, emailRaw.toLowerCase(), cost]
  );
}

export async function settleReservation(jobId: string): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `DELETE FROM app_gen_reservations WHERE job_id = $1`,
    [jobId]
  );
}

/** Refund + clear reservations older than the cutoff (orphaned by a crash /
 *  restart). Atomic claim via DELETE … RETURNING so concurrent sweeps never
 *  double-refund. Returns how many were refunded. */
export async function sweepStaleReservations(
  olderThanMin = 12
): Promise<number> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `DELETE FROM app_gen_reservations
       WHERE created_at < now() - ($1 || ' minutes')::interval
     RETURNING email, cost`,
    [String(olderThanMin)]
  );
  for (const r of rows) {
    // 占位被孤儿化(进程被杀、没结算):只释放在途占位即可。本金从未扣减
    // (扣减只在结算时发生),所以无需退本金、也不记流水。
    await refundCredits(r.email, r.cost).catch(() => {});
  }
  return rows.length;
}

export async function getSetting(k: string): Promise<string | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT v FROM app_settings WHERE k = $1`,
    [k]
  );
  return rows[0] ? (rows[0].v as string) : null;
}

export async function setSetting(k: string, v: string): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO app_settings (k, v, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`,
    [k, v]
  );
}

export type ArtworkRecord = {
  id: string;
  title: string;
  category: string;
  prompt: string;
  status: string;
  image: string;
  gradient: string;
  createdAt: string;
  style?: string | null;
  ratio?: string | null;
  resolution?: string | null;
  source?: string | null;
  batchId?: string | null;
  parentId?: string | null; // 血缘:这张图基于哪张作品(图生图底图)生成,根图为 null
  parentIds?: string[] | null; // 多输入:这张图额外的父节点(合并多张参考图);含 primary parentId 之外的
  templateId?: string | null; // 若这是"模板原图"根节点,记录它代表的模板 id
  canvasX?: number | null; // 画布手动拖拽后记住的坐标(空=用自动布局)
  canvasY?: number | null;
  groupId?: string | null; // 稳定项目分组:同项目所有节点共享,删节点也不变
  origin?: string | null; // 来源场景:"canvas"=在画布里产出(永远留画布);空=生图页/工具等普通产出
  // 出图当时的**计费与参数快照**(定价以后会调,不能事后按新表推算历史)。
  cost?: number | null; // 这张图实扣多少积分
  tokens?: number | null; // 实际消耗的上游 output tokens(真实成本核算用)
  quality?: string | null; // 质量档 low/medium/high(无质量档的模型为空)
  model?: string | null; // 用的哪个模型 id
  // 软删时间。**只有回收站列表会带**(正常列表这一列必然为 null,不查也不返回)。
  // 前台据此算"还剩几天被清理" —— 用户担心的是删了找不回来,给出确切天数才安心。
  deletedAt?: string | null;
};

export async function addArtworks(
  emailRaw: string,
  items: Omit<ArtworkRecord, "createdAt">[],
  batchId?: string
): Promise<void> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const a of items) {
      // 稳定分组:有父节点 → 继承父节点的 group_id(同一项目);无父(新根)→ 用自己的 id。
      let groupId: string = a.groupId ?? a.id;
      if (!a.groupId && a.parentId) {
        const pg = await client.query(
          `SELECT group_id FROM app_artworks WHERE id = $1 AND email = $2`,
          [a.parentId, email]
        );
        const pgid = pg.rows[0]?.group_id as string | null | undefined;
        groupId = pgid || a.parentId; // 父没有 group_id 时退而用父 id(根)
      }
      await client.query(
        `INSERT INTO app_artworks
           (id, email, title, category, prompt, status, image_url, gradient,
            style, ratio, resolution, source_url, batch_id, parent_id, template_id, parent_ids, group_id, origin,
            cost, quality, model, tokens)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`,
        [
          a.id,
          email,
          a.title,
          a.category,
          a.prompt,
          a.status,
          a.image,
          a.gradient,
          a.style ?? null,
          a.ratio ?? null,
          a.resolution ?? null,
          a.source ?? null,
          batchId ?? a.batchId ?? null,
          a.parentId ?? null,
          a.templateId ?? null,
          JSON.stringify(a.parentIds ?? []),
          groupId,
          a.origin ?? null,
          a.cost ?? null,
          a.quality ?? null,
          a.model ?? null,
          a.tokens ?? null,
        ]
      );
    }
    await client.query("COMMIT");
    // 落库成功后**立刻**让国内 OSS 把这几张图回源落盘(fire-and-forget,配了
    // OSS_WARM_BASE 才生效)。否则新图要等有人第一次浏览、或等当晚 04:30 的
    // 预热脚本才进 OSS —— 这段窗口里如果 Cloudflare 又被墙,这批图就取不到。
    // 见 lib/oss-warm。
    try {
      const { warmOss } = await import("@/lib/oss-warm");
      warmOss(items.flatMap((a) => [a.image, a.source ?? null]));
    } catch {
      /* 预热是锦上添花,永远不能影响落库 */
    }
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function listArtworks(
  emailRaw: string
): Promise<ArtworkRecord[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, title, category, prompt, status, image_url, gradient,
            style, ratio, resolution, source_url, batch_id, parent_id, template_id,
            parent_ids, canvas_x, canvas_y, group_id, origin, created_at,
            cost, quality, model, tokens
       FROM app_artworks
      WHERE email = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1000`,
    [emailRaw.toLowerCase()]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    prompt: r.prompt,
    status: r.status,
    image: r.image_url,
    gradient: r.gradient,
    style: r.style ?? null,
    ratio: r.ratio ?? null,
    resolution: r.resolution ?? null,
    source: r.source_url ?? null,
    batchId: r.batch_id ?? null,
    parentId: r.parent_id ?? null,
    parentIds: Array.isArray(r.parent_ids) ? (r.parent_ids as string[]) : [],
    templateId: r.template_id ?? null,
    canvasX: r.canvas_x ?? null,
    canvasY: r.canvas_y ?? null,
    groupId: r.group_id ?? null,
    origin: r.origin ?? null,
    cost: r.cost ?? null,
    quality: r.quality ?? null,
    model: r.model ?? null,
    tokens: r.tokens ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

// 只取指定 id 的几行作品(email 限定)。用于画布"创建/连线"后只补这几行,
// 而不是整表重拉 —— 大幅减少数据库出站流量(Supabase egress)。
export async function listArtworksByIds(
  emailRaw: string,
  ids: string[]
): Promise<ArtworkRecord[]> {
  await ensureSchema();
  const clean = ids.filter(Boolean);
  if (clean.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, title, category, prompt, status, image_url, gradient,
            style, ratio, resolution, source_url, batch_id, parent_id, template_id,
            parent_ids, canvas_x, canvas_y, group_id, origin, created_at,
            cost, quality, model, tokens
       FROM app_artworks
      WHERE email = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`,
    [emailRaw.toLowerCase(), clean]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    prompt: r.prompt,
    status: r.status,
    image: r.image_url,
    gradient: r.gradient,
    style: r.style ?? null,
    ratio: r.ratio ?? null,
    resolution: r.resolution ?? null,
    source: r.source_url ?? null,
    batchId: r.batch_id ?? null,
    parentId: r.parent_id ?? null,
    parentIds: Array.isArray(r.parent_ids) ? (r.parent_ids as string[]) : [],
    templateId: r.template_id ?? null,
    canvasX: r.canvas_x ?? null,
    canvasY: r.canvas_y ?? null,
    groupId: r.group_id ?? null,
    origin: r.origin ?? null,
    cost: r.cost ?? null,
    quality: r.quality ?? null,
    model: r.model ?? null,
    tokens: r.tokens ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

// 找/建"模板原图"根作品:用户首次从某模板「做同款」时,在其名下落一条代表该模板的
// 根作品(模板图+提示词,parent=null,template_id=模板id),后续同款生成都挂它下面。
// 同一用户+同一模板只建一条(去重),返回该根作品 id。
export async function ensureTemplateRoot(
  emailRaw: string,
  tpl: {
    templateId: string;
    image: string;
    prompt: string;
    title: string;
    gradient?: string | null;
    category?: string | null;
    ratio?: string | null;
  }
): Promise<string | null> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  if (!tpl.templateId || !tpl.image) return null;
  const found = await getPool().query(
    `SELECT id FROM app_artworks
       WHERE email = $1 AND template_id = $2 AND parent_id IS NULL
         AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
    [email, tpl.templateId]
  );
  if (found.rows[0]?.id) return found.rows[0].id as string;
  const id = `tplroot-${tpl.templateId}-${Date.now()}`;
  await getPool().query(
    `INSERT INTO app_artworks
       (id, email, title, category, prompt, status, image_url, gradient,
        style, ratio, resolution, source_url, batch_id, parent_id, template_id, group_id)
     VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,NULL,$8,NULL,NULL,NULL,NULL,$9,$1)`,
    [
      id,
      email,
      tpl.title.slice(0, 60) || "模板原图",
      tpl.category || "main",
      tpl.prompt,
      tpl.image,
      tpl.gradient || "from-slate-100 to-zinc-100",
      tpl.ratio || "1:1",
      tpl.templateId,
    ]
  );
  return id;
}

// --- 画布项目名(用户给血缘树/套图批次起的自定义名字) -------------------------
export async function getProjectNames(
  emailRaw: string
): Promise<Record<string, string>> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT key, name FROM app_project_names WHERE email = $1`,
    [emailRaw.toLowerCase()]
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.name;
  return out;
}

export async function setProjectName(
  emailRaw: string,
  key: string,
  nameRaw: string
): Promise<void> {
  await ensureSchema();
  const name = nameRaw.trim().slice(0, 60);
  const email = emailRaw.toLowerCase();
  if (!key || !name) return;
  await getPool().query(
    `INSERT INTO app_project_names (email, key, name, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (email, key) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
    [email, key, name]
  );
}

export type AdminArtwork = ArtworkRecord & { email: string };

function rowToAdminArtwork(r: {
  id: string;
  email: string;
  title: string;
  category: string;
  prompt: string;
  status: string;
  image_url: string;
  gradient: string;
  style: string | null;
  ratio: string | null;
  resolution: string | null;
  source_url: string | null;
  batch_id: string | null;
  created_at: Date;
}): AdminArtwork {
  return {
    id: r.id,
    email: r.email,
    title: r.title,
    category: r.category,
    prompt: r.prompt,
    status: r.status,
    image: r.image_url,
    gradient: r.gradient,
    style: r.style ?? null,
    ratio: r.ratio ?? null,
    resolution: r.resolution ?? null,
    source: r.source_url ?? null,
    batchId: r.batch_id ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const ADMIN_ARTWORK_COLS = `id, email, title, category, prompt, status,
  image_url, gradient, style, ratio, resolution, source_url, batch_id,
  created_at`;

/** Admin: every user's artworks, newest first, with owner email + total. */
export async function listAllArtworks(
  limit = 24,
  offset = 0
): Promise<{ artworks: AdminArtwork[]; total: number }> {
  await ensureSchema();
  const lim = Math.min(Math.max(Math.trunc(limit) || 24, 1), 100);
  const off = Math.max(Math.trunc(offset) || 0, 0);
  const [rowsRes, cntRes] = await Promise.all([
    getPool().query(
      `SELECT ${ADMIN_ARTWORK_COLS} FROM app_artworks
        ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [lim, off]
    ),
    getPool().query(`SELECT count(*)::int AS n FROM app_artworks`),
  ]);
  return {
    artworks: rowsRes.rows.map(rowToAdminArtwork),
    total: cntRes.rows[0].n,
  };
}

/** Admin: a single artwork by id (used when importing into the template lib). */
export async function getArtworkById(id: string): Promise<AdminArtwork | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT ${ADMIN_ARTWORK_COLS} FROM app_artworks WHERE id = $1`,
    [id]
  );
  return rows[0] ? rowToAdminArtwork(rows[0]) : null;
}

/** Admin: delete a single artwork. Also frees the R2 object IF no template
 *  (导入模板库 那条 / 任何 image 字段) still references that URL — otherwise
 *  the R2 object is preserved so the template image doesn't break. */
// 画布用:记住某作品在画布上被手动拖到的坐标(email 限定)。
export async function setArtworkPosition(
  emailRaw: string,
  id: string,
  x: number,
  y: number
): Promise<void> {
  await ensureSchema();
  if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return;
  await getPool().query(
    `UPDATE app_artworks SET canvas_x = $3, canvas_y = $4 WHERE email = $1 AND id = $2`,
    [emailRaw.toLowerCase(), id, x, y]
  );
}

// 给某节点追加一个父节点(多输入):合并进 parent_ids(去重,排除自身)。
export async function addArtworkParent(
  emailRaw: string,
  id: string,
  parentId: string
): Promise<void> {
  await ensureSchema();
  if (!id || !parentId || id === parentId) return;
  const email = emailRaw.toLowerCase();
  const { rows } = await getPool().query(
    `SELECT parent_id, parent_ids FROM app_artworks WHERE email = $1 AND id = $2`,
    [email, id]
  );
  if (!rows.length) return;
  const primary: string | null = rows[0].parent_id ?? null;
  const cur: string[] = Array.isArray(rows[0].parent_ids)
    ? (rows[0].parent_ids as string[])
    : [];
  const set = new Set(cur);
  // primary parentId 不重复放进 parent_ids
  if (parentId !== primary) set.add(parentId);
  // 若该节点本无 primary 父,把这个当 primary
  if (!primary) {
    await getPool().query(
      `UPDATE app_artworks SET parent_id = $3 WHERE email = $1 AND id = $2`,
      [email, id, parentId]
    );
    set.delete(parentId);
  }
  await getPool().query(
    `UPDATE app_artworks SET parent_ids = $3::jsonb WHERE email = $1 AND id = $2`,
    [email, id, JSON.stringify(Array.from(set))]
  );
}

// 画布:重命名节点(改作品标题)。email 限定。
export async function renameArtwork(
  emailRaw: string,
  id: string,
  title: string
): Promise<void> {
  await ensureSchema();
  const t = title.trim().slice(0, 80);
  if (!id || !t) return;
  await getPool().query(
    `UPDATE app_artworks SET title = $3 WHERE email = $1 AND id = $2`,
    [emailRaw.toLowerCase(), id, t]
  );
}

// 剪断连线:把某个父节点从节点的血缘里移除(primary 置空 / 从 parent_ids 移除)。
export async function removeArtworkParent(
  emailRaw: string,
  id: string,
  parentId: string
): Promise<void> {
  await ensureSchema();
  if (!id || !parentId) return;
  const email = emailRaw.toLowerCase();
  const { rows } = await getPool().query(
    `SELECT parent_id, parent_ids FROM app_artworks WHERE email = $1 AND id = $2`,
    [email, id]
  );
  if (!rows.length) return;
  const primary: string | null = rows[0].parent_id ?? null;
  const cur: string[] = Array.isArray(rows[0].parent_ids)
    ? (rows[0].parent_ids as string[])
    : [];
  const next = cur.filter((p) => p && p !== parentId);
  if (primary === parentId) {
    await getPool().query(
      `UPDATE app_artworks SET parent_id = NULL WHERE email = $1 AND id = $2`,
      [email, id]
    );
  }
  await getPool().query(
    `UPDATE app_artworks SET parent_ids = $3::jsonb WHERE email = $1 AND id = $2`,
    [email, id, JSON.stringify(next)]
  );
}

// 画布用:软删除某用户名下指定的一批作品(标记 deleted_at,进回收站,不真删)。
// email 限定,防越权。返回受影响条数。
export async function deleteArtworksByIds(
  emailRaw: string,
  ids: string[]
): Promise<number> {
  await ensureSchema();
  if (!ids || ids.length === 0) return 0;
  const r = await getPool().query(
    `UPDATE app_artworks SET deleted_at = now()
       WHERE email = $1 AND id = ANY($2) AND deleted_at IS NULL`,
    [emailRaw.toLowerCase(), ids]
  );
  return r.rowCount ?? 0;
}

// 回收站:取消软删除(恢复)。返回恢复条数。
export async function undeleteArtworksByIds(
  emailRaw: string,
  ids: string[]
): Promise<number> {
  await ensureSchema();
  if (!ids || ids.length === 0) return 0;
  const r = await getPool().query(
    `UPDATE app_artworks SET deleted_at = NULL
       WHERE email = $1 AND id = ANY($2) AND deleted_at IS NOT NULL`,
    [emailRaw.toLowerCase(), ids]
  );
  return r.rowCount ?? 0;
}

// 回收站:彻底删除(真删 DB 行,仅限已在回收站的)。返回删除条数。
export async function purgeArtworksByIds(
  emailRaw: string,
  ids: string[]
): Promise<number> {
  await ensureSchema();
  if (!ids || ids.length === 0) return 0;
  const r = await getPool().query(
    `DELETE FROM app_artworks
       WHERE email = $1 AND id = ANY($2) AND deleted_at IS NOT NULL`,
    [emailRaw.toLowerCase(), ids]
  );
  return r.rowCount ?? 0;
}

// 回收站列表(已软删除的),顺手把超过保留期(默认 180 天)的真删掉。
/** 回收站保留天数。与 /api/admin/storage 的 cron 清理**必须同源**,
 *  否则会出现"页面说还剩 N 天、cron 早就删了"的鬼故事。
 *  (原来这里写死 180 而 cron 用 30 —— 只因 cron 每天跑才没暴露,
 *   cron 一停行为就静默变成 180 天。) */
export const TRASH_RETENTION_DAYS = Number(
  process.env.ARTWORK_TRASH_DAYS || 30
);

export async function listDeletedArtworks(
  emailRaw: string,
  retentionDays = TRASH_RETENTION_DAYS
): Promise<ArtworkRecord[]> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  // 懒清理:打开回收站时顺手真删过期的
  await getPool()
    .query(
      `DELETE FROM app_artworks
         WHERE email = $1 AND deleted_at IS NOT NULL
           AND deleted_at < now() - ($2 || ' days')::interval`,
      [email, String(retentionDays)]
    )
    .catch(() => {});
  const { rows } = await getPool().query(
    `SELECT id, title, category, prompt, status, image_url, gradient,
            style, ratio, resolution, source_url, batch_id, parent_id, template_id,
            parent_ids, canvas_x, canvas_y, group_id, origin, created_at, deleted_at,
            cost, quality, model, tokens
       FROM app_artworks
      WHERE email = $1 AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC LIMIT 200`,
    [email]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    prompt: r.prompt,
    status: r.status,
    image: r.image_url,
    gradient: r.gradient,
    style: r.style ?? null,
    ratio: r.ratio ?? null,
    resolution: r.resolution ?? null,
    source: r.source_url ?? null,
    batchId: r.batch_id ?? null,
    parentId: r.parent_id ?? null,
    parentIds: Array.isArray(r.parent_ids) ? (r.parent_ids as string[]) : [],
    templateId: r.template_id ?? null,
    canvasX: r.canvas_x ?? null,
    canvasY: r.canvas_y ?? null,
    groupId: r.group_id ?? null,
    origin: r.origin ?? null,
    cost: r.cost ?? null,
    quality: r.quality ?? null,
    model: r.model ?? null,
    tokens: r.tokens ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
  }));
}

export async function deleteArtwork(id: string): Promise<boolean> {
  await ensureSchema();
  // Get the image_url before deleting (need it for R2 cleanup).
  const got = await getPool().query(
    `SELECT image_url FROM app_artworks WHERE id = $1`,
    [id]
  );
  const imageUrl = (got.rows[0]?.image_url as string | undefined) || "";

  const r = await getPool().query(`DELETE FROM app_artworks WHERE id = $1`, [
    id,
  ]);
  if ((r.rowCount ?? 0) === 0) return false;

  // Garbage-collect the R2 object if nothing else uses it.
  if (imageUrl) {
    const used = await getPool().query(
      `SELECT 1 FROM app_templates WHERE image = $1 LIMIT 1`,
      [imageUrl]
    );
    if ((used.rowCount ?? 0) === 0) {
      // Fire-and-forget; failure isn't critical and shouldn't block the response.
      const { deleteImageByUrl } = await import("./storage");
      void deleteImageByUrl(imageUrl);
    }
  }
  return true;
}

/** Given artwork ids, returns the subset already imported into the template
 *  library (template id convention: `tpl-art-<artworkId>`). */
export async function importedArtworkIds(ids: string[]): Promise<string[]> {
  await ensureSchema();
  if (ids.length === 0) return [];
  const tplIds = ids.map((id) => `tpl-art-${id}`);
  const { rows } = await getPool().query(
    `SELECT id FROM app_templates WHERE id = ANY($1)`,
    [tplIds]
  );
  return rows.map((r) => (r.id as string).replace(/^tpl-art-/, ""));
}

// --- Templates ------------------------------------------------------------

type TemplateRow = {
  id: string;
  title: string;
  category: string;
  industry: string;
  description: string;
  prompt: string;
  tags: string[];
  image: string;
  gradient: string;
  popular: boolean;
  homepageFeatured?: boolean;
  sourceImage?: string; // 白底原图(作品转模板带进来的);爬来的库模板为空
};

// SQL 列名 → JS key (DB 用 snake_case, JS 用 camelCase 透出去)
type TemplateRowRaw = Omit<TemplateRow, "homepageFeatured" | "sourceImage"> & {
  homepage_featured?: boolean;
  source_image?: string;
};

function rowToTemplate(r: TemplateRowRaw): TemplateRow {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    industry: r.industry,
    description: r.description,
    prompt: r.prompt,
    tags: r.tags ?? [],
    image: r.image,
    gradient: r.gradient,
    popular: r.popular === true,
    homepageFeatured: r.homepage_featured === true,
    sourceImage: r.source_image ?? "",
  };
}

export async function listTemplates(): Promise<TemplateRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query<TemplateRow>(
    `SELECT id, title, category, industry, description, prompt, tags,
            image, gradient, popular, homepage_featured, source_image
       FROM app_templates
      ORDER BY sort_index DESC, id ASC`
  );
  return rows.map(rowToTemplate);
}

/** Paged + filterable template list (server-side). Used by /api/templates. */
export async function listTemplatesPaged(opts: {
  category?: string;
  q?: string;
  ids?: string[];
  page?: number;
  pageSize?: number;
}): Promise<{ items: TemplateRow[]; total: number }> {
  await ensureSchema();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.ids && opts.ids.length > 0) {
    params.push(opts.ids);
    where.push(`id = ANY($${params.length})`);
  }
  if (opts.category) {
    params.push(opts.category);
    where.push(`category = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    const i = params.length;
    where.push(
      `(lower(title) LIKE $${i} OR lower(industry) LIKE $${i} OR lower(id) LIKE $${i} OR EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE lower(t) LIKE $${i}))`
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 24));
  const offset = (page - 1) * pageSize;
  const totalRes = await getPool().query<{ n: string }>(
    `SELECT count(*)::int AS n FROM app_templates ${whereSql}`,
    params
  );
  const total = Number(totalRes.rows[0]?.n ?? 0);
  // 省 egress:列表浏览不取 prompt 长文本(16k 模板每页拉一堆全文 → 流量大头);
  // 只有按 ids 精确取详情(预览弹层 / 生成页做同款)才 SELECT prompt。
  const detail = !!(opts.ids && opts.ids.length > 0);
  const promptCol = detail ? "prompt" : "'' AS prompt";
  // source_image(白底原图)同样只在详情(ids,做同款/预览)取,列表浏览不取省流量。
  const sourceCol = detail ? "source_image" : "'' AS source_image";
  const itemsRes = await getPool().query<TemplateRow>(
    `SELECT id, title, category, industry, description, ${promptCol}, tags,
            image, gradient, popular, homepage_featured, ${sourceCol}
       FROM app_templates ${whereSql}
      ORDER BY sort_index DESC, id ASC
      LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );
  return { items: itemsRes.rows.map(rowToTemplate), total };
}

// --- User favorites (collections of templates) -----------------------------

/** Return the user's favorite template IDs, newest-favorited first. */
export async function listUserFavs(email: string): Promise<string[]> {
  await ensureSchema();
  const { rows } = await getPool().query<{ template_id: string }>(
    `SELECT template_id FROM app_user_favs
      WHERE email = $1
      ORDER BY created_at DESC`,
    [email]
  );
  return rows.map((r) => r.template_id);
}

/** Idempotent — re-favoriting an id is a no-op (ON CONFLICT DO NOTHING). */
export async function addUserFav(
  email: string,
  templateId: string
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO app_user_favs (email, template_id)
     VALUES ($1, $2)
     ON CONFLICT (email, template_id) DO NOTHING`,
    [email, templateId]
  );
}

export async function removeUserFav(
  email: string,
  templateId: string
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `DELETE FROM app_user_favs WHERE email = $1 AND template_id = $2`,
    [email, templateId]
  );
}

/** Templates an admin has manually flagged with the 上首页 toggle — these
 *  are guaranteed to show on the homepage regardless of auto-pool eligibility
 *  (no dim data / unusual aspect / weird tags etc.). */
export async function listHomepageFeaturedTemplates(): Promise<TemplateRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query<TemplateRow>(
    `SELECT id, title, category, industry, description, prompt, tags,
            image, gradient, popular, homepage_featured
       FROM app_templates
      WHERE homepage_featured = true`
  );
  return rows.map(rowToTemplate);
}

/** Toggle the 上首页 flag on a template (admin action). */
export async function setTemplateHomepageFeatured(
  id: string,
  featured: boolean
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE app_templates SET homepage_featured = $2 WHERE id = $1`,
    [id, featured]
  );
}

/** Fetch all templates in a given set of categories — used by the homepage
 *  picker (SSR). Returns the same shape as listTemplatesPaged but without
 *  pagination or text search. */
export async function listTemplatesInCategories(
  categories: string[]
): Promise<TemplateRow[]> {
  await ensureSchema();
  if (categories.length === 0) return [];
  const { rows } = await getPool().query<TemplateRow>(
    `SELECT id, title, category, industry, description, prompt, tags,
            image, gradient, popular, homepage_featured
       FROM app_templates
      WHERE category = ANY($1)`,
    [categories]
  );
  return rows.map(rowToTemplate);
}

/** {category, count} pairs for the templates filter sidebar. */
export async function listTemplateCategories(): Promise<
  { name: string; count: number }[]
> {
  await ensureSchema();
  const { rows } = await getPool().query<{ name: string; count: string }>(
    `SELECT category AS name, count(*)::int AS count
       FROM app_templates
      WHERE category <> ''
      GROUP BY category
      ORDER BY count(*) DESC, category ASC`
  );
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}

export async function getTemplate(
  id: string
): Promise<TemplateRow | null> {
  await ensureSchema();
  const { rows } = await getPool().query<TemplateRow>(
    `SELECT id, title, category, industry, description, prompt, tags,
            image, gradient, popular, homepage_featured
       FROM app_templates WHERE id = $1`,
    [id]
  );
  return rows[0] ? rowToTemplate(rows[0]) : null;
}

export async function updateTemplate(
  id: string,
  patch: Partial<TemplateRow>
): Promise<TemplateRow | null> {
  await ensureSchema();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const cols: Record<string, unknown> = {
    title: patch.title,
    category: patch.category,
    industry: patch.industry,
    description: patch.description,
    prompt: patch.prompt,
    tags: patch.tags,
    image: patch.image,
    gradient: patch.gradient,
    popular: patch.popular,
    homepage_featured: patch.homepageFeatured,
  };
  for (const [k, v] of Object.entries(cols)) {
    if (v !== undefined) {
      sets.push(`${k} = $${i++}`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return getTemplate(id);
  sets.push(`updated_at = now()`);
  vals.push(id);
  const { rows } = await getPool().query<TemplateRow>(
    `UPDATE app_templates SET ${sets.join(", ")}
      WHERE id = $${i} RETURNING *`,
    vals
  );
  return rows[0] ? rowToTemplate(rows[0]) : null;
}

/** Creates a template, placing it on top (highest sort_index). Idempotent on
 *  id: if the id already exists, the existing row is returned unchanged so
 *  importing the same artwork twice never duplicates. */
export async function createTemplate(
  t: Omit<PromptTemplate, "id"> & { id?: string }
): Promise<{ template: TemplateRow; created: boolean }> {
  await ensureSchema();
  const id =
    t.id && t.id.trim()
      ? t.id.trim()
      : `tpl-imp-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const mx = await getPool().query(
    `SELECT COALESCE(MAX(sort_index), 0)::int AS m FROM app_templates`
  );
  const sort = mx.rows[0].m + 1;
  // 重新导入(同 id 冲突)时刷新内容 + 回填白底原图,让「重新导入」名副其实
  //(也给早先导入、还没存原图的旧模板补上 source_image)。created 用 xmax=0 判定。
  const { rows } = await getPool().query<TemplateRow & { created: boolean }>(
    `INSERT INTO app_templates
       (id, title, category, industry, description, prompt, tags,
        image, gradient, popular, sort_index, source_image)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        prompt = EXCLUDED.prompt,
        image = EXCLUDED.image,
        gradient = EXCLUDED.gradient,
        source_image = EXCLUDED.source_image
     RETURNING *, (xmax = 0) AS created`,
    [
      id,
      t.title,
      t.category,
      t.industry ?? "",
      t.description ?? "",
      t.prompt,
      t.tags ?? [],
      t.image ?? "",
      t.gradient ?? "from-emerald-100 to-teal-100",
      t.popular === true,
      sort,
      t.sourceImage ?? "",
    ]
  );
  if (rows[0]) return { template: rowToTemplate(rows[0]), created: rows[0].created };
  throw new Error("模板创建失败");
}

/** Seeds the templates table from the bundled static list if it's empty.
 *  Idempotent thanks to ON CONFLICT DO NOTHING. */
// Sync the bundled template list (templates-data.ts) into this instance's DB.
// `templates-data.ts` is the single source of truth for bulk templates: each
// deploy runs this once, inserting any NEW templates (by id). Existing rows are
// left untouched (ON CONFLICT DO NOTHING) so admin-panel edits/additions are
// never clobbered. Because both the 海外 and 国内 instances share this code and
// both redeploy on a template change, a scraped batch lands on both sites
// automatically — no separate DB-to-DB sync needed.
export async function syncTemplatesFromCode(
  seed: PromptTemplate[]
): Promise<{ inserted: number; total: number; skipped?: boolean }> {
  await ensureSchema();

  // Fast-path: if the DB already has at least as many rows as the seed,
  // every seed id is either already inserted or has been deleted on purpose
  // — either way, running 6000+ no-op INSERTs over the pooler is the wrong
  // thing to do (it was making the first /api/templates request after every
  // pm2 restart block 30-60s). Skip entirely. Cold starts and template-batch
  // additions fall through to the batched insert below.
  const cnt = await getPool().query<{ n: string }>(
    `SELECT count(*)::int AS n FROM app_templates`
  );
  const have = Number(cnt.rows[0]?.n ?? 0);
  if (have >= seed.length) {
    return { inserted: 0, total: seed.length, skipped: true };
  }

  // Cold path: batched multi-row INSERT (≈500 rows per statement, ~13 round
  // trips for 6500 templates vs 6500 individual statements).
  const COLS = 11;
  const BATCH = 500;
  const client = await getPool().connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (let start = 0; start < seed.length; start += BATCH) {
      const slice = seed.slice(start, start + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      slice.forEach((t, j) => {
        const base = j * COLS;
        placeholders.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${
            base + 6
          },$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`
        );
        values.push(
          t.id,
          t.title,
          t.category,
          t.industry ?? "",
          t.description ?? "",
          t.prompt,
          t.tags ?? [],
          t.image ?? "",
          t.gradient ?? "from-emerald-100 to-teal-100",
          t.popular === true,
          seed.length - (start + j) // newest (index 0) gets the highest sort_index
        );
      });
      const r = await client.query(
        `INSERT INTO app_templates
           (id, title, category, industry, description, prompt, tags,
            image, gradient, popular, sort_index)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      inserted += r.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { inserted, total: seed.length };
}

/**
 * 导入一批模板(买家实例「同步官方模板库」用):ON CONFLICT DO NOTHING,
 * 不覆盖站长本地改动。sort_index 按官方全库位置倒排(offset 越小 = 越新 = 越大),
 * 与官方站展示顺序一致。
 */
export async function importTemplates(
  items: Array<{
    id: string;
    title: string;
    category: string;
    industry?: string;
    description?: string;
    prompt?: string;
    tags?: string[];
    image?: string;
    gradient?: string;
    popular?: boolean;
  }>,
  totalCount: number,
  offset: number
): Promise<number> {
  await ensureSchema();
  if (items.length === 0) return 0;
  const values: unknown[] = [];
  const placeholders: string[] = [];
  const COLS = 11;
  items.forEach((t, j) => {
    const base = j * COLS;
    placeholders.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${
        base + 6
      },$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`
    );
    values.push(
      t.id,
      t.title,
      t.category ?? "",
      t.industry ?? "",
      t.description ?? "",
      t.prompt ?? "",
      t.tags ?? [],
      t.image ?? "",
      t.gradient ?? "from-emerald-100 to-teal-100",
      t.popular === true,
      Math.max(0, totalCount - (offset + j))
    );
  });
  const r = await getPool().query(
    `INSERT INTO app_templates
       (id, title, category, industry, description, prompt, tags,
        image, gradient, popular, sort_index)
     VALUES ${placeholders.join(",")}
     ON CONFLICT (id) DO NOTHING`,
    values
  );
  return r.rowCount ?? 0;
}

/**
 * 把模板表里现存的 *.r2.dev 直链图片改写为同源代理(/api/tpl-image?u=…)。
 * 「同步官方模板库」首页调用一次,修掉早期同步进来的直链(大陆浏览器对 r2.dev
 * 有 SNI 阻断,直链会加载失败)。幂等:已是代理形式的行不匹配、不再改。
 */
export async function rewriteTemplateImagesToProxy(): Promise<number> {
  await ensureSchema();
  const { rows } = await getPool().query<{ id: string; image: string }>(
    `SELECT id, image FROM app_templates
      WHERE image LIKE 'https://%.r2.dev/%'`
  );
  if (rows.length === 0) return 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      await client.query(`UPDATE app_templates SET image = $2 WHERE id = $1`, [
        r.id,
        `/api/tpl-image?u=${encodeURIComponent(r.image)}`,
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return rows.length;
}

// --- Phone binding (a phone bound to an account is stored on app_users.phone;
//     phone-OTP login resolves a bound phone to that account's email) ---------

/** The account email that has this phone bound, or null. */
export async function findEmailByBoundPhone(
  phone: string
): Promise<string | null> {
  await ensureSchema();
  const r = await getPool().query(
    `SELECT email FROM app_users WHERE phone = $1 LIMIT 1`,
    [phone]
  );
  return r.rows[0]?.email ?? null;
}

/** Whether this Supabase auth email already exists (e.g. a synthetic phone account). */
export async function authEmailExists(email: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query(
    `SELECT 1 FROM auth.users WHERE email = $1 LIMIT 1`,
    [email]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Bind a phone to an existing account (by email). Returns false if no row. */
export async function bindPhoneToEmail(
  email: string,
  phone: string
): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query(
    `UPDATE app_users SET phone = $2 WHERE email = $1`,
    [email, phone]
  );
  return (r.rowCount ?? 0) > 0;
}

// ── genchat 对话会话(多会话持久化) ──
export type GenchatSessionMeta = { id: string; title: string; updatedAt: string };

export async function listGenchatSessions(
  email: string
): Promise<GenchatSessionMeta[]> {
  if (!dbEnabled) return [];
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, title, updated_at FROM app_genchat_sessions
     WHERE email = $1 ORDER BY updated_at DESC LIMIT 50`,
    [email.toLowerCase()]
  );
  return rows.map((r) => ({
    id: r.id as string,
    title: (r.title as string) || "",
    updatedAt: new Date(r.updated_at as string).toISOString(),
  }));
}

export async function getGenchatSession(
  email: string,
  id: string
): Promise<{ id: string; title: string; turns: unknown } | null> {
  if (!dbEnabled) return null;
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, title, turns FROM app_genchat_sessions WHERE email = $1 AND id = $2`,
    [email.toLowerCase(), id]
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, title: rows[0].title || "", turns: rows[0].turns };
}

export async function saveGenchatSession(
  email: string,
  id: string,
  title: string,
  turns: unknown
): Promise<void> {
  if (!dbEnabled) return;
  await ensureSchema();
  await getPool().query(
    `INSERT INTO app_genchat_sessions (id, email, title, turns, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title, turns = EXCLUDED.turns, updated_at = now()`,
    [id, email.toLowerCase(), title.slice(0, 120), JSON.stringify(turns ?? [])]
  );
}

export async function deleteGenchatSession(
  email: string,
  id: string
): Promise<void> {
  if (!dbEnabled) return;
  await ensureSchema();
  await getPool().query(
    `DELETE FROM app_genchat_sessions WHERE email = $1 AND id = $2`,
    [email.toLowerCase(), id]
  );
}

// ===========================================================================
// 存储治理:保留期清理 + 用量统计
// ---------------------------------------------------------------------------
// 产品里一直写着「保留 180 天」,但**从来没有清理任务**(空承诺,存储只增不减)。
// 这里补上:①回收站里超期的软删作品真删 ②正常作品超保留期也清。
// 图片对象一并删除 —— 只删库不删对象的话,存储照样涨。
// ===========================================================================

export type PurgeResult = { rows: number; objects: number };

/**
 * 清理超期作品。返回删了多少行/多少个对象。
 * @param keepDays  正常作品保留天数(0 = 不清正常作品,只清回收站)
 * @param trashDays 回收站里的软删作品保留天数
 * @param onDelete  删除图片对象的回调(传 deleteImageByUrl;db.ts 不能 import storage)
 */
export async function purgeOldArtworks(
  keepDays: number,
  trashDays: number,
  onDelete: (url: string) => Promise<boolean>
): Promise<PurgeResult> {
  if (!dbEnabled) return { rows: 0, objects: 0 };
  await ensureSchema();
  const pool = getPool();
  // 一次取一批,避免一口气删太多把库锁住;调用方可重复调直到 rows=0。
  const { rows } = await pool.query<{ id: string; image_url: string }>(
    `SELECT id, image_url FROM app_artworks
      WHERE (deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1))
         OR ($2::int > 0 AND deleted_at IS NULL AND created_at < now() - make_interval(days => $2))
      LIMIT 500`,
    [Math.max(1, trashDays), Math.max(0, keepDays)]
  );
  if (!rows.length) return { rows: 0, objects: 0 };

  // ⚠️ **删对象前必须排除还被别处引用的图**(2026-08-16 实测抓到 7 例):
  //   · 作品转模板后,模板的 image 与原作品 image_url 是**同一个对象** —— 删作品会让
  //     模板库裂图(库里 1.6 万个模板,坏一个就是线上事故);
  //   · 子图的 source_url 指向父图(前后对比栏用),删父图会让对比栏裂。
  // 库里的行照删(用户的作品该消失),但**对象只在没人再引用时才删**。
  const urls = rows.map((r) => r.image_url).filter(Boolean);
  const referenced = new Set<string>();
  if (urls.length) {
    const [tpl, child] = await Promise.all([
      pool.query<{ u: string }>(
        `SELECT image AS u FROM app_templates WHERE image = ANY($1::text[])
          UNION SELECT source_image AS u FROM app_templates WHERE source_image = ANY($1::text[])`,
        [urls]
      ),
      pool.query<{ u: string }>(
        `SELECT DISTINCT source_url AS u FROM app_artworks
          WHERE source_url = ANY($1::text[]) AND id <> ALL($2::text[])`,
        [urls, rows.map((r) => r.id)]
      ),
    ]);
    for (const r of tpl.rows) if (r.u) referenced.add(r.u);
    for (const r of child.rows) if (r.u) referenced.add(r.u);
  }

  let objects = 0;
  let kept = 0;
  for (const r of rows) {
    if (!r.image_url) continue;
    if (referenced.has(r.image_url)) {
      kept++; // 还被模板/子图引用 → 只删库行,保留对象
      continue;
    }
    if (await onDelete(r.image_url).catch(() => false)) objects++;
  }
  if (kept) console.log(`[purge] ${kept} 个对象因仍被模板/子图引用而保留`);
  const del = await pool.query(`DELETE FROM app_artworks WHERE id = ANY($1::text[])`, [
    rows.map((r) => r.id),
  ]);
  return { rows: del.rowCount ?? 0, objects };
}

/** 全站存储用量(字节数按图片条数估算 —— 我们不存文件大小,用均值折算)。 */
export type StorageUsage = {
  totalArtworks: number;
  trashArtworks: number;
  byUser: { email: string; count: number }[];
};

export async function storageUsage(topN = 20): Promise<StorageUsage> {
  if (!dbEnabled) return { totalArtworks: 0, trashArtworks: 0, byUser: [] };
  await ensureSchema();
  const pool = getPool();
  const [tot, byUser] = await Promise.all([
    pool.query<{ total: number; trash: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trash
         FROM app_artworks`
    ),
    pool.query<{ email: string; count: number }>(
      `SELECT email, COUNT(*)::int AS count FROM app_artworks
        WHERE deleted_at IS NULL
        GROUP BY email ORDER BY count DESC LIMIT $1`,
      [topN]
    ),
  ]);
  return {
    totalArtworks: tot.rows[0]?.total ?? 0,
    trashArtworks: tot.rows[0]?.trash ?? 0,
    byUser: byUser.rows,
  };
}

// ===========================================================================
// 站点访问统计(app_page_views)
// ---------------------------------------------------------------------------
// 采集端点写、后台面板读。所有「一天」的边界都按 ANALYTICS_TZ(默认东八区)切,
// 否则服务器跑 UTC 时国内看到的「今天」会从早上 8 点才开始。
// ===========================================================================

/** 一次页面浏览。失败静默 —— 统计永远不能影响正常访问。 */
export async function recordPageView(v: {
  path: string;
  visitor: string;
  sid: string;
  country: string | null;
  device: string;
  browser: string;
  refHost: string;
  locale: string;
}): Promise<void> {
  if (!dbEnabled) return;
  await ensureSchema();
  await getPool().query(
    `INSERT INTO app_page_views
       (day, path, visitor, sid, country, device, browser, ref_host, locale)
     VALUES ((now() AT TIME ZONE $9)::date, $1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      v.path.slice(0, 180),
      v.visitor.slice(0, 64),
      v.sid.slice(0, 40),
      v.country ? v.country.slice(0, 2).toUpperCase() : null,
      v.device.slice(0, 16),
      v.browser.slice(0, 32),
      v.refHost.slice(0, 120),
      v.locale.slice(0, 12),
      ANALYTICS_TZ,
    ]
  );
}

/** 删掉超过保留期的明细。采集端点低概率触发,不另起定时任务。 */
export async function purgeOldPageViews(keepDays: number): Promise<number> {
  if (!dbEnabled) return 0;
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `DELETE FROM app_page_views
      WHERE day < (now() AT TIME ZONE $2)::date - ($1::int - 1)`,
    [Math.max(1, keepDays), ANALYTICS_TZ]
  );
  return rowCount ?? 0;
}

// 维度聚合的公共写法:按 key 分组数 PV 和去重 UV,空值归一到 fallback 桶。
function dimQuery(expr: string, fallback: string): string {
  return `SELECT COALESCE(NULLIF(${expr}, ''), '${fallback}') AS key,
                 COUNT(*)::int AS pv,
                 COUNT(DISTINCT visitor)::int AS uv
            FROM app_page_views
           WHERE day > (now() AT TIME ZONE $2)::date - $1::int
           GROUP BY 1
           ORDER BY pv DESC
           LIMIT 12`;
}

/**
 * 后台「访问统计」面板的一次性数据包。
 * days=1 表示「今天」(day > 今天-1,即只剩今天这一天)。
 */
export async function analyticsOverview(
  days: number
): Promise<Omit<AnalyticsOverview, "geoReady">> {
  const d = Math.max(1, Math.min(365, Math.floor(days)));
  const empty = {
    days: d,
    totals: { pv: 0, uv: 0, sessions: 0 },
    prev: { pv: 0, uv: 0 },
    online: 0,
    daily: [] as DailyRow[],
    countries: [] as CountRow[],
    paths: [] as CountRow[],
    referrers: [] as CountRow[],
    devices: [] as CountRow[],
    browsers: [] as CountRow[],
  };
  if (!dbEnabled) return empty;
  await ensureSchema();
  const pool = getPool();
  const p = [d, ANALYTICS_TZ] as const;

  type Agg = { key: string; pv: number; uv: number };
  const [totals, prev, online, daily, countries, paths, referrers, devices, browsers] =
    await Promise.all([
      pool.query<{ pv: number; uv: number; sessions: number }>(
        `SELECT COUNT(*)::int AS pv,
                COUNT(DISTINCT visitor)::int AS uv,
                COUNT(DISTINCT NULLIF(sid, ''))::int AS sessions
           FROM app_page_views
          WHERE day > (now() AT TIME ZONE $2)::date - $1::int`,
        [...p]
      ),
      // 上一个等长周期(用于同比):[今天-2d, 今天-d]
      pool.query<{ pv: number; uv: number }>(
        `SELECT COUNT(*)::int AS pv, COUNT(DISTINCT visitor)::int AS uv
           FROM app_page_views
          WHERE day > (now() AT TIME ZONE $2)::date - ($1::int * 2)
            AND day <= (now() AT TIME ZONE $2)::date - $1::int`,
        [...p]
      ),
      pool.query<{ n: number }>(
        `SELECT COUNT(DISTINCT visitor)::int AS n
           FROM app_page_views
          WHERE ts > now() - interval '30 minutes'`
      ),
      pool.query<{ day: string; pv: number; uv: number }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS pv,
                COUNT(DISTINCT visitor)::int AS uv
           FROM app_page_views
          WHERE day > (now() AT TIME ZONE $2)::date - $1::int
          GROUP BY day
          ORDER BY day`,
        [...p]
      ),
      pool.query<Agg>(dimQuery("country", "未知"), [...p]),
      pool.query<Agg>(dimQuery("path", "/"), [...p]),
      pool.query<Agg>(dimQuery("ref_host", "直接访问"), [...p]),
      pool.query<Agg>(dimQuery("device", "desktop"), [...p]),
      pool.query<Agg>(dimQuery("browser", "其他"), [...p]),
    ]);

  return {
    days: d,
    totals: {
      pv: totals.rows[0]?.pv ?? 0,
      uv: totals.rows[0]?.uv ?? 0,
      sessions: totals.rows[0]?.sessions ?? 0,
    },
    prev: { pv: prev.rows[0]?.pv ?? 0, uv: prev.rows[0]?.uv ?? 0 },
    online: online.rows[0]?.n ?? 0,
    daily: daily.rows,
    countries: countries.rows,
    paths: paths.rows,
    referrers: referrers.rows,
    devices: devices.rows,
    browsers: browsers.rows,
  };
}

// ===========================================================================
// 视频生成任务(火山引擎方舟 Seedance 异步)
// ---------------------------------------------------------------------------
// 生成一条视频要几十秒到数分钟,不能在路由里同步等。流程:
//   POST /api/video        → 预扣积分 → 建方舟任务 → createVideoJob(pending)
//   GET  /api/video/status → 查方舟 → settleVideoJob 原子转成 succeeded|failed
// 结算是**一次性**的:WHERE status='pending' ... RETURNING 保证并发轮询里只有一
// 个请求拿到 job,所以不会重复退积分、也不会重复落作品。
// ===========================================================================

export type VideoJob = {
  taskId: string;
  email: string;
  cost: number;
  status: string;
  title: string;
  prompt: string;
  resolution: string;
  duration: number;
  sourceUrl: string | null;
  parentId: string | null;
  artworkId: string | null;
  videoUrl: string | null;
  error: string | null;
};

function rowToVideoJob(r: Record<string, unknown>): VideoJob {
  return {
    taskId: r.task_id as string,
    email: r.email as string,
    cost: Number(r.cost ?? 0),
    status: r.status as string,
    title: (r.title as string) ?? "",
    prompt: (r.prompt as string) ?? "",
    resolution: (r.resolution as string) ?? "",
    duration: Number(r.duration ?? 0),
    sourceUrl: (r.source_url as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
    artworkId: (r.artwork_id as string) ?? null,
    videoUrl: (r.video_url as string) ?? null,
    error: (r.error as string) ?? null,
  };
}

/** 登记一个已预扣积分的待办任务。 */
export async function createVideoJob(job: {
  taskId: string;
  email: string;
  cost: number;
  title: string;
  prompt: string;
  resolution: string;
  duration: number;
  sourceUrl?: string | null;
  parentId?: string | null;
}): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO app_video_jobs
       (task_id, email, cost, title, prompt, resolution, duration, source_url, parent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (task_id) DO NOTHING`,
    [
      job.taskId,
      job.email.toLowerCase(),
      job.cost,
      job.title,
      job.prompt,
      job.resolution,
      job.duration,
      job.sourceUrl ?? null,
      job.parentId ?? null,
    ]
  );
}

/** 读任务(校验归属用:email 不匹配返回 null,防越权查别人的任务)。 */
export async function getVideoJob(
  taskId: string,
  emailRaw?: string
): Promise<VideoJob | null> {
  await ensureSchema();
  const r = await getPool().query(
    `SELECT * FROM app_video_jobs WHERE task_id = $1`,
    [taskId]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (emailRaw && row.email !== emailRaw.toLowerCase()) return null;
  return rowToVideoJob(row);
}

/**
 * 结算任务。只有把 pending 转成终态的那一次调用会返回 job(即"结算权"),
 * 其余并发调用返回 null —— 调用方据此决定要不要退积分 / 落作品。
 */
export async function settleVideoJob(
  taskId: string,
  outcome:
    | { status: "succeeded"; videoUrl: string; artworkId: string }
    | { status: "failed"; error: string }
): Promise<VideoJob | null> {
  await ensureSchema();
  const r = await getPool().query(
    `UPDATE app_video_jobs
        SET status = $2,
            video_url = $3,
            artwork_id = $4,
            error = $5,
            settled_at = now()
      WHERE task_id = $1 AND status = 'pending'
      RETURNING *`,
    [
      taskId,
      outcome.status,
      outcome.status === "succeeded" ? outcome.videoUrl : null,
      outcome.status === "succeeded" ? outcome.artworkId : null,
      outcome.status === "failed" ? outcome.error.slice(0, 500) : null,
    ]
  );
  const row = r.rows[0];
  return row ? rowToVideoJob(row) : null;
}

// ============================================================================
// 邀请有奖(2026-10-21 客户要求,参考同行「推广中心」,去掉了上级邀请人与月度梯度奖励)
//   · 每个用户一个 6 位邀请码,专属链接 = 站点/?invite=码;好友注册时自动(或手填)绑定,一人只能绑一次;
//   · 奖励数字全部后台可调(app_settings.invite_config),默认:好友注册得 50、邀请人得 50、
//     好友首次充值(在线付款,兑换码/后台加分不算)邀请人再得 200;
//   · 防刷:同 IP 24 小时内重复注册只绑关系不发奖;每个邀请人每月最多拿 N 个好友的奖励;
//   · 所有奖励走「新人赠送」同一套发放口径(先从站点库存划拨,库存不足就不发)。
// 功能默认关闭,站长在后台打开才生效。
// ============================================================================
export type InviteConfig = {
  enabled: boolean;
  inviteeBonus: number; // 被邀请人注册奖励
  inviterSignup: number; // 邀请人:好友注册奖励
  inviterRecharge: number; // 邀请人:好友首次充值奖励
  monthlyCap: number; // 每个邀请人每月最多拿多少个好友的奖励(0 = 不限)
  defaultSlogan: string; // 默认推广语(用户没自己改时用)
};
const INVITE_CONFIG_KEY = "invite_config";
const INVITE_DEFAULTS: InviteConfig = {
  enabled: false,
  inviteeBonus: 50,
  inviterSignup: 50,
  inviterRecharge: 200,
  monthlyCap: 50,
  defaultSlogan: "",
};
const INVITEE_REWARD_DAYS = 30; // 与新人赠送一致
const INVITER_REWARD_DAYS = 365;

function inviteInt(v: unknown, fallback: number, max = 100000): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
}

function normalizeInviteConfig(c: Partial<InviteConfig>): InviteConfig {
  return {
    enabled: !!c.enabled,
    inviteeBonus: inviteInt(c.inviteeBonus, INVITE_DEFAULTS.inviteeBonus),
    inviterSignup: inviteInt(c.inviterSignup, INVITE_DEFAULTS.inviterSignup),
    inviterRecharge: inviteInt(c.inviterRecharge, INVITE_DEFAULTS.inviterRecharge),
    monthlyCap: inviteInt(c.monthlyCap, INVITE_DEFAULTS.monthlyCap, 10000),
    defaultSlogan: String(c.defaultSlogan ?? "").trim().slice(0, 60),
  };
}

export async function getInviteConfig(): Promise<InviteConfig> {
  try {
    const raw = await getSetting(INVITE_CONFIG_KEY);
    if (raw) return normalizeInviteConfig({ ...INVITE_DEFAULTS, ...JSON.parse(raw) });
  } catch {
    /* 读失败回退默认 */
  }
  return { ...INVITE_DEFAULTS };
}

export async function saveInviteConfig(patch: Partial<InviteConfig>): Promise<InviteConfig> {
  const next = normalizeInviteConfig({ ...(await getInviteConfig()), ...patch });
  await setSetting(INVITE_CONFIG_KEY, JSON.stringify(next));
  return next;
}

// 去掉 0/O/1/I/L 这类容易看错的字符
const INVITE_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 取用户的邀请码(没有就生成一个)。 */
export async function getOrCreateInviteCode(
  emailRaw: string
): Promise<{ code: string; slogan: string }> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
  const read = async () =>
    (
      await getPool().query<{ code: string; slogan: string }>(
        `SELECT code, slogan FROM app_invite_codes WHERE email = $1`,
        [email]
      )
    ).rows[0];
  const have = await read();
  if (have) return have;
  const { randomInt } = await import("crypto");
  for (let i = 0; i < 8; i++) {
    const code = Array.from({ length: 6 }, () => INVITE_CODE_CHARS[randomInt(INVITE_CODE_CHARS.length)]).join("");
    const { rows } = await getPool().query<{ code: string; slogan: string }>(
      `INSERT INTO app_invite_codes (email, code) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING code, slogan`,
      [email, code]
    );
    if (rows[0]) return rows[0];
    const again = await read(); // 并发下别的请求已经建好了
    if (again) return again;
  }
  throw new Error("邀请码生成失败,请重试");
}

export async function saveInviteSlogan(emailRaw: string, slogan: string): Promise<void> {
  await getOrCreateInviteCode(emailRaw);
  await getPool().query(`UPDATE app_invite_codes SET slogan = $2 WHERE email = $1`, [
    emailRaw.toLowerCase(),
    slogan.trim().slice(0, 60),
  ]);
}

/** 发一笔邀请奖励(从站点库存划拨,库存不足返回 0 = 没发)。 */
async function grantInviteCredits(
  email: string,
  amount: number,
  reason: string,
  days: number
): Promise<number> {
  if (amount <= 0) return 0;
  const { reserveIssue } = await import("@/lib/credit-issue");
  const stock = await reserveIssue(amount);
  if (!stock.ok) return 0;
  const d = new Date();
  d.setDate(d.getDate() + days);
  await addCreditBatch(email, amount, { source: "grant", reason, expiresAt: d, ledgerKind: "grant" });
  return amount;
}

/** 该邀请人本月是否还没到奖励上限。 */
async function inviterUnderCap(inviter: string, cap: number): Promise<boolean> {
  if (cap <= 0) return true;
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT count(*) AS n FROM app_invites
      WHERE inviter = $1 AND NOT revoked
        AND (signup_reward > 0 OR recharge_reward > 0)
        AND created_at >= date_trunc('month', now())`,
    [inviter]
  );
  return Number(rows[0]?.n ?? 0) < cap;
}

/**
 * 新用户注册后绑定邀请关系并发奖。只在**新注册**时调用一次;
 * 码无效/自己邀请自己/已绑定过/功能没开 → 什么都不做。返回被邀请人拿到的积分。
 */
export async function bindInvite(
  inviteeRaw: string,
  codeRaw: string,
  ip: string
): Promise<number> {
  await ensureSchema();
  const cfg = await getInviteConfig();
  if (!cfg.enabled) return 0;
  const invitee = inviteeRaw.toLowerCase();
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return 0;
  const { rows } = await getPool().query<{ email: string }>(
    `SELECT email FROM app_invite_codes WHERE code = $1`,
    [code]
  );
  const inviter = rows[0]?.email;
  if (!inviter || inviter === invitee) return 0;
  // 同 IP 24 小时内已有人通过邀请注册 → 只记关系不发奖(挡批量注册小号)
  const ipDup =
    !!ip &&
    (
      await getPool().query(
        `SELECT 1 FROM app_invites WHERE ip = $1 AND created_at > now() - interval '24 hours' LIMIT 1`,
        [ip]
      )
    ).rows.length > 0;
  const ins = await getPool().query(
    `INSERT INTO app_invites (invitee, inviter, code, ip, note) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (invitee) DO NOTHING RETURNING invitee`,
    [invitee, inviter, code, ip || "", ipDup ? "同 IP 24 小时内重复注册,未发奖励" : ""]
  );
  if (!ins.rows[0] || ipDup) return 0;
  const inviteeReward = await grantInviteCredits(invitee, cfg.inviteeBonus, "邀请注册奖励", INVITEE_REWARD_DAYS);
  const signupReward = (await inviterUnderCap(inviter, cfg.monthlyCap))
    ? await grantInviteCredits(inviter, cfg.inviterSignup, "邀请好友注册奖励", INVITER_REWARD_DAYS)
    : 0;
  await getPool().query(
    `UPDATE app_invites SET invitee_reward = $2, signup_reward = $3 WHERE invitee = $1`,
    [invitee, inviteeReward, signupReward]
  );
  return inviteeReward;
}

/** 被邀请人第一次在线充值成功后,给邀请人发首充奖励(幂等,只发一次)。 */
export async function rewardInviteRecharge(inviteeRaw: string): Promise<void> {
  await ensureSchema();
  const cfg = await getInviteConfig();
  if (!cfg.enabled) return;
  const { rows } = await getPool().query<{ inviter: string; note: string }>(
    `UPDATE app_invites SET recharged_at = now()
      WHERE invitee = $1 AND recharged_at IS NULL AND NOT revoked
      RETURNING inviter, note`,
    [inviteeRaw.toLowerCase()]
  );
  const r = rows[0];
  if (!r || r.note) return; // 没有邀请关系 / 被标记为可疑(同 IP)
  if (!(await inviterUnderCap(r.inviter, cfg.monthlyCap))) return;
  const amt = await grantInviteCredits(r.inviter, cfg.inviterRecharge, "邀请好友首充奖励", INVITER_REWARD_DAYS);
  if (amt > 0) {
    await getPool().query(`UPDATE app_invites SET recharge_reward = $2 WHERE invitee = $1`, [
      inviteeRaw.toLowerCase(),
      amt,
    ]);
  }
}

/** 推广中心里显示好友账号:手机号 138****2210,邮箱 li***@qq.com。 */
function maskInvitee(email: string): string {
  const [local, domain = ""] = email.split("@");
  if (/^\d{11}$/.test(local)) return `${local.slice(0, 3)}****${local.slice(7)}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export type InviteRecord = {
  who: string;
  at: string;
  recharged: boolean;
  reward: number;
  revoked: boolean;
};

/** 推广中心概览:邀请码、推广语、奖励规则、统计与邀请记录。 */
export async function getInviteOverview(emailRaw: string) {
  const email = emailRaw.toLowerCase();
  const [{ code, slogan }, cfg] = await Promise.all([getOrCreateInviteCode(email), getInviteConfig()]);
  const { rows } = await getPool().query<{
    invitee: string;
    created_at: Date;
    recharged_at: Date | null;
    signup_reward: number;
    recharge_reward: number;
    revoked: boolean;
  }>(
    `SELECT invitee, created_at, recharged_at, signup_reward, recharge_reward, revoked
       FROM app_invites WHERE inviter = $1 ORDER BY created_at DESC LIMIT 200`,
    [email]
  );
  const records: InviteRecord[] = rows.map((r) => ({
    who: maskInvitee(r.invitee),
    at: new Date(r.created_at).toISOString(),
    recharged: !!r.recharged_at,
    reward: r.revoked ? 0 : r.signup_reward + r.recharge_reward,
    revoked: r.revoked,
  }));
  return {
    code,
    slogan: slogan || cfg.defaultSlogan,
    rules: {
      inviteeBonus: cfg.inviteeBonus,
      inviterSignup: cfg.inviterSignup,
      inviterRecharge: cfg.inviterRecharge,
    },
    invited: records.filter((r) => !r.revoked).length,
    effective: records.filter((r) => r.recharged && !r.revoked).length,
    earned: records.reduce((n, r) => n + r.reward, 0),
    records,
  };
}

/** 后台:邀请记录总表(可按邀请人/被邀请人搜索)。 */
export async function listInvites(q = "", limit = 300) {
  await ensureSchema();
  const like = `%${q.trim().toLowerCase()}%`;
  const { rows } = await getPool().query<{
    invitee: string;
    inviter: string;
    code: string;
    ip: string;
    invitee_reward: number;
    signup_reward: number;
    recharge_reward: number;
    recharged_at: Date | null;
    note: string;
    revoked: boolean;
    created_at: Date;
  }>(
    `SELECT * FROM app_invites
      WHERE ($1 = '%%' OR invitee LIKE $1 OR inviter LIKE $1 OR code LIKE upper($1))
      ORDER BY created_at DESC LIMIT $2`,
    [like, Math.min(Math.max(limit, 1), 1000)]
  );
  return rows.map((r) => ({
    invitee: r.invitee,
    inviter: r.inviter,
    code: r.code,
    ip: r.ip,
    inviteeReward: r.invitee_reward,
    inviterReward: r.signup_reward + r.recharge_reward,
    recharged: !!r.recharged_at,
    note: r.note,
    revoked: r.revoked,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** 后台:撤销一条邀请(作弊等):标记撤销,并扣回已发给邀请人的奖励(余额不够扣到 0 为止)。 */
export async function revokeInvite(inviteeRaw: string): Promise<{ deducted: number }> {
  await ensureSchema();
  const { rows } = await getPool().query<{ inviter: string; s: number; r: number }>(
    `UPDATE app_invites SET revoked = true
      WHERE invitee = $1 AND NOT revoked
      RETURNING inviter, signup_reward AS s, recharge_reward AS r`,
    [inviteeRaw.toLowerCase()]
  );
  const row = rows[0];
  if (!row) return { deducted: 0 };
  const amt = row.s + row.r;
  if (amt > 0) await adjustUserCredits(row.inviter, -amt, "撤销邀请奖励").catch(() => {});
  return { deducted: amt };
}
