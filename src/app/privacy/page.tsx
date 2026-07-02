import { ShieldCheck } from "lucide-react";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { BRAND, BRAND_EMAIL } from "@/lib/brand";

export const metadata = { title: `隐私政策 — ${BRAND}` };

export default function PrivacyPage() {
  const locale = getServerLocale();
  return locale === "en" ? <PrivacyEn /> : <PrivacyZh />;
}

function PrivacyZh() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-primary">
        <ShieldCheck className="h-4 w-4" />
        隐私政策
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {BRAND} 隐私政策
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">最后更新：2026-05-24</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">
            1. 我们收集的信息
          </h2>
          <p className="mt-2">为了向你提供服务，我们会收集以下类别的信息：</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">账号信息</strong>：邮箱、
              昵称、加密后的密码（由认证服务托管，我们不接触明文）。
            </li>
            <li>
              <strong className="text-foreground">使用信息</strong>：你上传的
              产品图、输入的提示词、生成的图像、生成时间、所选风格与比例、
              积分变更流水。
            </li>
            <li>
              <strong className="text-foreground">技术信息</strong>：最近一次
              登录的 IP 地址（用于安全审计与封禁滥用）、浏览器与设备类型、
              访问日志。
            </li>
            <li>
              <strong className="text-foreground">支付信息</strong>：经由第三方
              支付服务商处理，我们不存储你的完整卡号或银行账户信息，仅记录
              订单号、金额、状态。
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">2. 信息用途</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>提供并维持图像生成、模板库、作品库等核心功能；</li>
            <li>记录与展示你的生成历史，方便复用与下载；</li>
            <li>计费、对账与发票；</li>
            <li>防止滥用、刷量、攻击与违法使用；</li>
            <li>响应你的支持请求；</li>
            <li>在你同意的前提下，发送产品更新或营销邮件（可随时退订）。</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            3. 第三方服务与跨境传输
          </h2>
          <p className="mt-2">
            为了正常运转，我们会在必要范围内将相关数据交由若干第三方服务商
            处理，类别包括：
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">AI 模型服务</strong>：
              处理你输入的提示词与上传图，以生成图像。
            </li>
            <li>
              <strong className="text-foreground">
                云服务（鉴权、数据库、对象存储与 CDN）
              </strong>
              ：用于账号、数据与图像的存储、加速与分发。
            </li>
            <li>
              <strong className="text-foreground">支付服务商</strong>：
              处理订单付款（会员套餐与一次性积分包）。
            </li>
          </ul>
          <p className="mt-2">
            上述部分服务商的服务器或处理活动可能位于中国大陆以外的国家或地区；
            使用本服务，即表示你同意为实现相应功能所必需的跨境数据处理。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            4. Cookie 与本地存储
          </h2>
          <p className="mt-2">
            我们使用浏览器 LocalStorage 保存登录状态、收藏的模板等便于
            提升体验。不使用跨站追踪 Cookie 进行广告投放。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">5. 信息保留</h2>
          <p className="mt-2">
            账号信息在账号存续期间保留。生成记录与图像默认保留至你主动
            删除或账号注销。法律法规另有规定的，按规定执行（如交易记录的
            财务保存期）。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">6. 你的权利</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>访问、更正你的账号信息（在账户页内自助操作）；</li>
            <li>请求删除账号及其相关数据（联系 {BRAND_EMAIL}）；</li>
            <li>导出你的生成记录（如有需要请联系我们）；</li>
            <li>撤回对营销邮件的订阅；</li>
            <li>在适用法律下，向监管机构投诉。</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">7. 信息安全</h2>
          <p className="mt-2">
            我们采用 HTTPS 传输、最小权限数据库访问、密钥分级管理（API Key
            服务端加密存储、敏感凭证不入版本控制）等措施保护你的信息。
            互联网传输与存储无法做到绝对安全，请妥善保管账号密码并使用
            强密码。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">8. 儿童隐私</h2>
          <p className="mt-2">
            本服务不面向 14 周岁以下的未成年人。如发现误收集未成年人信息，
            请联系我们以删除。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">9. 政策更新</h2>
          <p className="mt-2">
            本政策会随产品与法规演进进行更新。更新版本会在本页面发布并标注
            更新日期。重大修改将通过邮件或站内提示通知。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">10. 联系我们</h2>
          <p className="mt-2">
            本服务由广东星泽科技有限公司（备案号：粤ICP备2025390640号-1）运营。
            如对本政策有任何疑问，或希望行使上述权利，请通过
            {" "}{BRAND_EMAIL} 联系我们。
          </p>
        </section>
      </div>
    </div>
  );
}

function PrivacyEn() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-primary">
        <ShieldCheck className="h-4 w-4" />
        Privacy Policy
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {BRAND} Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: 2026-05-24
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">
            1. Information we collect
          </h2>
          <p className="mt-2">
            To provide the service, we collect the following categories of
            information:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">Account info</strong>: email,
              nickname, hashed password (managed by our authentication service —
              we never see the plaintext).
            </li>
            <li>
              <strong className="text-foreground">Usage info</strong>: product
              images you upload, prompts you enter, generated images, generation
              time, chosen style and ratio, and credit-change history.
            </li>
            <li>
              <strong className="text-foreground">Technical info</strong>: your
              most recent login IP (for security auditing and abuse blocking),
              browser and device type, and access logs.
            </li>
            <li>
              <strong className="text-foreground">Payment info</strong>: handled
              by third-party payment providers. We do not store your full card
              or bank account number — only order id, amount and status.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            2. How we use information
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Provide and maintain core features such as image generation, the
              template library and your gallery;
            </li>
            <li>Record and show your generation history for reuse and download;</li>
            <li>Billing, reconciliation and invoicing;</li>
            <li>Prevent abuse, fraud, attacks and illegal use;</li>
            <li>Respond to your support requests;</li>
            <li>
              With your consent, send product updates or marketing emails (you
              can unsubscribe anytime).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            3. Third-party services & cross-border transfer
          </h2>
          <p className="mt-2">
            To operate, we share necessary data with a number of third-party
            providers, in the following categories:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">AI model services</strong>:
              process the prompts and images you submit in order to generate
              images.
            </li>
            <li>
              <strong className="text-foreground">
                Cloud services (authentication, database, object storage & CDN)
              </strong>
              : store, accelerate and deliver your account, data and images.
            </li>
            <li>
              <strong className="text-foreground">Payment providers</strong>:
              process order payments (memberships and one-time credit packs).
            </li>
          </ul>
          <p className="mt-2">
            Some of these providers&rsquo; servers or processing may be located
            in countries or regions outside mainland China; by using the service
            you consent to the cross-border data processing necessary to provide
            these features.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            4. Cookies & local storage
          </h2>
          <p className="mt-2">
            We use browser LocalStorage to remember login state, favorited
            templates and similar preferences to improve your experience. We do
            not use cross-site tracking cookies for advertising.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            5. Data retention
          </h2>
          <p className="mt-2">
            Account info is kept while your account exists. Generation records
            and images are kept until you delete them or close your account,
            unless a law requires otherwise (e.g. financial retention of
            transaction records).
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            6. Your rights
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Access and correct your account info (self-service on the account page);</li>
            <li>Request deletion of your account and related data (contact {BRAND_EMAIL});</li>
            <li>Export your generation records (contact us if needed);</li>
            <li>Unsubscribe from marketing emails;</li>
            <li>Lodge a complaint with a regulator where applicable law allows.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            7. Information security
          </h2>
          <p className="mt-2">
            We protect your data with HTTPS transport, least-privilege database
            access and tiered key management (API keys encrypted server-side,
            sensitive credentials kept out of version control). No internet
            transmission or storage is perfectly secure, so please keep your
            password safe and use a strong one.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            8. Children&rsquo;s privacy
          </h2>
          <p className="mt-2">
            This service is not intended for minors under 14. If we inadvertently
            collected a minor&rsquo;s information, please contact us to delete
            it.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            9. Policy updates
          </h2>
          <p className="mt-2">
            This policy will evolve with the product and regulations. Updated
            versions are posted here with a revised date. Material changes will
            be notified by email or an in-app notice.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            10. Contact us
          </h2>
          <p className="mt-2">
            The service is operated by Guangdong Xingze Technology Co., Ltd. (ICP
            filing: 粤ICP备2025390640号-1). For any questions about this policy,
            or to exercise the rights above, contact us at {BRAND_EMAIL}.
          </p>
        </section>
      </div>
    </div>
  );
}
