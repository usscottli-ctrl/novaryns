import "server-only";
import { Pool, type PoolClient } from "pg";
import {
  POINTS_PER_IMAGE,
  type PlanKey,
  type PromptTemplate,
} from "@/lib/mock-data";
import type { SessionUser, Invoice } from "@/lib/auth-context";

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
    if (bonus > 0) {
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
  reason: string
): Promise<void> {
  await ensureSchema();
  const email = emailRaw.toLowerCase();
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
    return;
  }
  await getPool().query(
    `INSERT INTO app_ledger (id, email, delta, reason, kind) VALUES ($1,$2,$3,$4,$5)`,
    [ledId(), email, delta, reason, delta > 0 ? "grant" : "consume"]
  );
}

/** Per-user credit ledger — for the admin member detail view. */
export async function listUserLedger(
  emailRaw: string,
  limit = 100
): Promise<LedgerRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, email, delta, reason, kind, expires_at, created_at
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
    // Pro 授权直售订单:不发积分,标记已付后在事务外幂等生成 License Key
    // (ensureProLicenseForOrder,按 batch=orderId 去重)。积分订单走原批次逻辑。
    if (o.kind !== "pro") {
      // 到账 = 建一个 2 年有效的积分批次(不再分 plan/pack,按订单存的 credits 入账;
      // 遗留的会员订单后付款也能正常入账)。在同一事务里写批次 + 购买流水 + 同步余额。
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
  return { ok: true, alreadyPaid: false, order: updated ?? undefined };
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
export async function reserveCredits(
  emailRaw: string,
  n: number
): Promise<boolean> {
  // 是否计费:①Supabase 多用户(官方云)②原生多用户 ③站长手动开的「积分计费」开关
  //(单用户也可开来给自己/他人做用量控制)。三者任一为真则扣分,否则放行(不扣)。
  // 动态 import 避免静态循环。
  const email = emailRaw.toLowerCase();
  const { supabaseEnabled } = await import("@/lib/auth-mode");
  const { multiUserEnabled, creditsMeteringOn } = await import(
    "@/lib/native-auth"
  );
  const meterOn =
    supabaseEnabled || (await multiUserEnabled()) || (await creditsMeteringOn());
  if (!meterOn) return true; // 未开计费 → 放行,不扣积分
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
  // 与 reserveCredits 放行口径一致:未计费的场景无需退款。
  const { supabaseEnabled } = await import("@/lib/auth-mode");
  const { multiUserEnabled, creditsMeteringOn } = await import(
    "@/lib/native-auth"
  );
  const meterOn =
    supabaseEnabled || (await multiUserEnabled()) || (await creditsMeteringOn());
  if (!meterOn) return;
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
            style, ratio, resolution, source_url, batch_id, parent_id, template_id, parent_ids, group_id, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)
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
        ]
      );
    }
    await client.query("COMMIT");
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
            parent_ids, canvas_x, canvas_y, group_id, origin, created_at
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
            parent_ids, canvas_x, canvas_y, group_id, origin, created_at
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
export async function listDeletedArtworks(
  emailRaw: string,
  retentionDays = 180
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
            parent_ids, canvas_x, canvas_y, group_id, origin, created_at, deleted_at
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
    createdAt: new Date(r.created_at).toISOString(),
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
