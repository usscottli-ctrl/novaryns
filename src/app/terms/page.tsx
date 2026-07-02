import { FileText } from "lucide-react";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { BRAND, BRAND_EMAIL } from "@/lib/brand";

export const metadata = { title: `服务条款 — ${BRAND}` };

export default function TermsPage() {
  const locale = getServerLocale();
  return locale === "en" ? <TermsEn /> : <TermsZh />;
}

function TermsZh() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-primary">
        <FileText className="h-4 w-4" />
        服务条款
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {BRAND} 服务条款
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">最后更新：2026-05-24</p>

      <div className="prose-novaryns mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">1. 服务说明</h2>
          <p className="mt-2">
            {BRAND}（「我们」/「本平台」，由广东星泽科技有限公司运营）是一款
            面向电商营销的 B2B 生产力工具，
            服务对象为电商卖家、品牌方与代运营团队，帮助其高效产出商业视觉，
            功能包括文生图、图生图、提示词模板库、作品管理与积分计费。
            使用本服务，即视为你（「用户」）已阅读、理解并同意本条款。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">2. 账号与注册</h2>
          <p className="mt-2">
            你需要使用真实有效的邮箱完成注册。你应对账号下的一切活动负责，
            妥善保管密码并立即向我们报告任何未经授权的使用。一人或一家
            实体仅可注册一个账号，禁止滥用注册渠道。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            3. 用户内容与生成内容
          </h2>
          <p className="mt-2">
            你上传到平台的产品图、提示词等（「用户内容」）的所有权与责任归你
            所有；你保证有权上传，且不侵犯任何第三方权益。在不超出提供服务
            所必需的范围内，你授予我们处理、存储、传输用户内容的非独占许可。
          </p>
          <p className="mt-2">
            由 AI 模型生成的图像（「生成内容」）在符合本条款与底层模型条款的
            前提下归你使用。你应自行评估生成内容是否适合商用，并对其使用结果
            负责。我们不保证生成内容的独创性、与第三方作品的不相似性，或
            符合任何特定法域的法规要求。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">4. 积分与付款</h2>
          <p className="mt-2">
            本服务采用积分制计费：每次生成消耗对应数量的积分。积分通过购买
            会员套餐（按月单次购买）或一次性积分包获得。会员为单次付款，到期
            不会自动续费、不会自动扣款；如需继续，请在到期前后手动续费，续费后
            当月积分重置。一次性积分包不随会员重置。具体规则以下单时页面展示为准。
          </p>
          <p className="mt-2">
            支付通过支付宝等第三方支付服务商处理（微信支付即将开通）；支付服务商
            可能记录与处理你的支付信息，详见其各自的
            隐私政策。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            5. 退款政策（不退款）
          </h2>
          <p className="mt-2">
            由于生成会即时产生算力成本，<strong>所有积分购买与会员套餐一经支付，
            概不退款</strong>。Due to the computational costs of AI generation,
            all purchases and credits are non-refundable.
          </p>
          <p className="mt-2">
            会员为单次付款、不自动续费，因此无需「取消订阅」；当期权益可使用至
            到期，已付费用不退。仅在发生<strong>重复扣款或系统性扣费错误</strong>时，
            请于 7 日内联系 {BRAND_EMAIL}，我们将核实后按实际情况处理。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">6. 知识产权</h2>
          <p className="mt-2">
            平台本身的代码、设计、商标、文案、模板库的组织与编排等均为
            {BRAND} 或其授权方所有，受相关法律保护。未经书面许可，
            不得复制、修改、二次分发或反向工程。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">7. 禁止行为</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>使用本服务从事违反所在地法律法规的活动；</li>
            <li>侵犯他人肖像权、版权、商标权、隐私权或其他合法权益；</li>
            <li>生成色情、暴力、仇恨、虚假信息或其他违法/违反公序良俗内容；</li>
            <li>恶意刷量、滥用、绕过计费、攻击服务可用性；</li>
            <li>未经授权的自动化访问或对接口进行逆向。</li>
          </ul>
          <p className="mt-2">
            如发现违反，我们可随时暂停或终止你的账号，并保留追究法律责任的权利。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">8. 第三方服务</h2>
          <p className="mt-2">
            本服务在运行过程中会用到若干第三方服务商（包括云基础设施、AI
            模型与支付等）。你使用本服务，即同时受这些第三方相应条款的约束。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">9. 免责声明</h2>
          <p className="mt-2">
            本服务按「现状」提供。我们尽力维持服务可用与生成质量，但不就连续性、
            准确性、适销性或特定用途适用性作出明示或暗示保证。在适用法律允许
            的最大范围内，我们对任何间接、附带或后果性损失不承担责任。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            10. 服务变更与终止
          </h2>
          <p className="mt-2">
            我们可不时调整服务内容、积分价格、套餐结构与可用区域。重大变更
            会在合理时间内通过站内或邮件通知。你可随时停止使用并申请删除账号；
            我们也可在你严重违反本条款时单方终止服务。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">11. 条款修订</h2>
          <p className="mt-2">
            本条款会随产品演进进行更新，更新版本会在本页面发布并标注更新日期。
            重大修改我们会主动通知；继续使用即视为接受修订后的条款。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            12. 适用法律与争议解决
          </h2>
          <p className="mt-2">
            本服务由广东星泽科技有限公司（备案号：粤ICP备2025390640号-1）运营。
            本条款的订立、效力、解释与履行适用中华人民共和国大陆地区法律。
          </p>
          <p className="mt-2">
            如发生争议，双方应先友好协商；协商不成时，任一方可向广东星泽科技
            有限公司所在地有管辖权的人民法院提起诉讼。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">13. 联系</h2>
          <p className="mt-2">
            如对本条款有任何疑问，请通过 {BRAND_EMAIL} 联系我们。
          </p>
        </section>
      </div>
    </div>
  );
}

function TermsEn() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-primary">
        <FileText className="h-4 w-4" />
        Terms of Service
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {BRAND} Terms of Service
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: 2026-05-24
      </p>

      <div className="prose-novaryns mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">
            1. About the service
          </h2>
          <p className="mt-2">
            {BRAND} (&ldquo;we&rdquo; / &ldquo;the platform&rdquo;, operated by
            Guangdong Xingze Technology Co., Ltd.) is a B2B productivity tool for
            e-commerce marketing, serving online sellers,
            brands and agencies to efficiently produce commercial visuals.
            Features include text-to-image, image-to-image, a prompt template
            library, work management and credit-based billing. By using the
            service you (&ldquo;the user&rdquo;) have read, understood and agreed
            to these terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            2. Accounts & registration
          </h2>
          <p className="mt-2">
            You must register with a real, valid email. You are responsible for
            all activity under your account, must keep your password safe, and
            must report any unauthorized use to us immediately. One person or
            entity may register only one account; abuse of registration channels
            is prohibited.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            3. User content & generated content
          </h2>
          <p className="mt-2">
            Product images, prompts and other content you upload (&ldquo;user
            content&rdquo;) belong to and are your responsibility; you warrant
            you have the right to upload it and that it infringes no third-party
            rights. To the extent necessary to provide the service, you grant us
            a non-exclusive license to process, store and transmit user content.
          </p>
          <p className="mt-2">
            Images produced by AI models (&ldquo;generated content&rdquo;) are
            yours to use, subject to these terms and the underlying model&rsquo;s
            terms. You should assess whether generated content is suitable for
            commercial use and are responsible for its use. We do not warrant the
            originality of generated content, its dissimilarity to third-party
            works, or compliance with any specific jurisdiction&rsquo;s rules.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            4. Credits & payment
          </h2>
          <p className="mt-2">
            The service is billed by credits: each generation consumes a number
            of credits. Credits are obtained by purchasing a membership (a
            one-time purchase per month) or one-time credit packs. Memberships
            are a single payment — they do not auto-renew and you are never
            auto-charged; to continue, renew manually around the expiry date,
            after which that month&rsquo;s credits reset. One-time packs do not
            reset with membership. The exact rules are as shown on the checkout
            page at order time.
          </p>
          <p className="mt-2">
            Payment is processed by third-party providers such as Alipay, with
            WeChat Pay coming soon; the provider may record and process your
            payment information — see their
            respective privacy policies.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            5. Refund policy (no refunds)
          </h2>
          <p className="mt-2">
            Because generation incurs real-time compute cost,{" "}
            <strong>
              all credit purchases and memberships are non-refundable once paid
            </strong>
            .
          </p>
          <p className="mt-2">
            Memberships are a single payment and do not auto-renew, so there is
            nothing to &ldquo;cancel&rdquo; — your benefits last until the end of
            the current period and fees already paid are not refunded. Only in
            case of{" "}
            <strong>duplicate charges or a systemic billing error</strong>,
            contact {BRAND_EMAIL} within 7 days and we will verify and
            handle it accordingly.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            6. Intellectual property
          </h2>
          <p className="mt-2">
            The platform&rsquo;s own code, design, trademarks, copy, and the
            organization and arrangement of the template library belong to
            {BRAND} or its licensors and are protected by law. No copying,
            modification, redistribution or reverse engineering without written
            permission.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            7. Prohibited conduct
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Using the service for activities that break local laws;</li>
            <li>
              Infringing others&rsquo; portrait, copyright, trademark, privacy or
              other lawful rights;
            </li>
            <li>
              Generating pornographic, violent, hateful, false or otherwise
              unlawful / immoral content;
            </li>
            <li>
              Malicious volume abuse, bypassing billing, or attacking service
              availability;
            </li>
            <li>
              Unauthorized automated access or reverse-engineering of our APIs.
            </li>
          </ul>
          <p className="mt-2">
            On any violation we may suspend or terminate your account at any time
            and reserve the right to pursue legal liability.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            8. Third-party services
          </h2>
          <p className="mt-2">
            The service relies on a number of third-party providers (including
            cloud infrastructure, AI models and payments) to operate. By using
            the service you are also bound by the respective terms of these
            third parties.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            9. Disclaimer
          </h2>
          <p className="mt-2">
            The service is provided &ldquo;as is&rdquo;. We strive to keep it
            available and maintain generation quality, but make no express or
            implied warranty of continuity, accuracy, merchantability or fitness
            for a particular purpose. To the maximum extent permitted by law, we
            are not liable for any indirect, incidental or consequential loss.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            10. Changes & termination
          </h2>
          <p className="mt-2">
            We may adjust service content, credit prices, plan structure and
            available regions from time to time. Material changes will be
            notified within a reasonable time via in-app or email. You may stop
            using the service and request account deletion anytime; we may also
            unilaterally terminate the service if you seriously breach these
            terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            11. Amendments
          </h2>
          <p className="mt-2">
            These terms will be updated as the product evolves; updated versions
            are posted here with a revised date. We will proactively notify
            material changes; continued use means acceptance of the revised
            terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            12. Governing law & disputes
          </h2>
          <p className="mt-2">
            The service is operated by Guangdong Xingze Technology Co., Ltd. (ICP
            filing: 粤ICP备2025390640号-1). The formation, validity,
            interpretation and performance of these terms are governed by the
            laws of the mainland of the People&rsquo;s Republic of China.
          </p>
          <p className="mt-2">
            In case of a dispute, the parties shall first negotiate in good
            faith; failing that, either party may bring an action before the
            people&rsquo;s court with jurisdiction at the location of Guangdong
            Xingze Technology Co., Ltd.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">13. Contact</h2>
          <p className="mt-2">
            For any questions about these terms, contact us at{" "}
            {BRAND_EMAIL}.
          </p>
        </section>
      </div>
    </div>
  );
}
