import Link from "next/link";
import { Mail, Clock, MessageSquare } from "lucide-react";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { BRAND, BRAND_EMAIL } from "@/lib/brand";
import { editionName } from "@/lib/edition";
import { getSitePage } from "@/lib/settings";
import { CustomPage } from "@/components/custom-page";

export const metadata = { title: `联系我们 — ${BRAND}` };

export default async function ContactPage() {
  const locale = getServerLocale();
  // 自部署实例:渲染站长后台自定义的「联系我们」(默认页含我们的邮箱,不给自部署者显示)。
  if (editionName !== "cloud") {
    const custom = await getSitePage("contact");
    return (
      <CustomPage
        title={locale === "en" ? "Contact" : "联系我们"}
        content={
          custom ||
          (locale === "en" ? "Content coming soon." : "内容建设中，敬请期待。")
        }
      />
    );
  }
  return locale === "en" ? <ContactEn /> : <ContactZh />;
}

function ContactZh() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">联系我们</h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        我们认真对待每一封邮件。一般在 1 个工作日内回复，复杂问题最长 3 个工作日。
      </p>

      <Link
        href={`mailto:${BRAND_EMAIL}`}
        className="group mt-10 block rounded-2xl border border-border bg-card p-8 transition-all hover:-translate-y-0.5 card-shadow"
      >
        <div className="flex items-start gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mail className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">邮件联系</p>
            <p className="mt-1 break-all text-xl font-semibold text-primary group-hover:underline">
              {BRAND_EMAIL}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              客户支持、商务合作、媒体咨询，目前均通过这个邮箱接收。
              我们会按主题分流处理。
            </p>
          </div>
        </div>
      </Link>

      <div className="mt-6 rounded-2xl border border-border bg-secondary/40 p-6">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-primary" />
          工作时间
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          周一至周五 · 09:00–18:00（GMT+8）。非工作时间发来的邮件，
          我们会在下一个工作日处理。
        </p>
      </div>

      <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <p>
          Tips：发邮件时附上你的注册邮箱 + 操作截图，能让我们更快定位问题。
          请在邮件标题中标注 [支持] / [商务] / [媒体] 便于分流。
        </p>
      </div>
    </div>
  );
}

function ContactEn() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Contact us
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        We read every email. We usually reply within 1 business day — up to 3
        for complex issues.
      </p>

      <Link
        href={`mailto:${BRAND_EMAIL}`}
        className="group mt-10 block rounded-2xl border border-border bg-card p-8 transition-all hover:-translate-y-0.5 card-shadow"
      >
        <div className="flex items-start gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mail className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="mt-1 break-all text-xl font-semibold text-primary group-hover:underline">
              {BRAND_EMAIL}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Customer support, business and press inquiries all go to this
              inbox. We route by topic.
            </p>
          </div>
        </div>
      </Link>

      <div className="mt-6 rounded-2xl border border-border bg-secondary/40 p-6">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-primary" />
          Working hours
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Mon–Fri · 09:00–18:00 (GMT+8). Emails sent outside these hours are
          handled the next business day.
        </p>
      </div>

      <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <p>
          Tip: include your account email + a screenshot so we can locate the
          issue faster. Please tag the subject with [Support] / [Business] /
          [Press].
        </p>
      </div>
    </div>
  );
}
