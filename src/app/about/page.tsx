import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Sparkles,
  Wand2,
  LayoutGrid,
  Coins,
  History,
  type LucideIcon,
} from "lucide-react";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `关于 ${BRAND} — ${BRAND}` };

type Item = { icon?: LucideIcon; title: string; desc: string };

function AboutLayout({
  kicker,
  title,
  intro,
  problemsLabel,
  problems,
  howLabel,
  how,
  nowLabel,
  now,
  ctaPrimary,
  ctaSecondary,
}: {
  kicker: string;
  title: string;
  intro: string;
  problemsLabel: string;
  problems: Item[];
  howLabel: string;
  how: Item[];
  nowLabel: string;
  now: string;
  ctaPrimary: string;
  ctaSecondary: string;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
      {/* Hero */}
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-primary">
        <Sparkles className="h-4 w-4" />
        {kicker}
      </p>
      <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-[2.75rem]">
        {title}
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        {intro}
      </p>

      {/* 我们解决什么问题 — 3 卡片 */}
      <h2 className="mt-14 text-xl font-semibold sm:text-2xl">{problemsLabel}</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {problems.map((p) => (
          <div
            key={p.title}
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h3 className="text-base font-semibold text-foreground">
              {p.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {p.desc}
            </p>
          </div>
        ))}
      </div>

      {/* 我们怎么做 — 2 列带图标卡片 */}
      <h2 className="mt-14 text-xl font-semibold sm:text-2xl">{howLabel}</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {how.map((h) => {
          const Icon = h.icon ?? Sparkles;
          return (
            <div
              key={h.title}
              className="flex gap-4 rounded-2xl border border-border bg-card p-5"
            >
              <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {h.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {h.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 现在的我们 — 高亮带 */}
      <div className="mt-14 rounded-2xl border border-border bg-secondary/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold sm:text-2xl">{nowLabel}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {now}
        </p>
      </div>

      {/* CTA */}
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Button asChild variant="gradient" size="lg">
          <Link href="/generate">
            {ctaPrimary}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/contact">{ctaSecondary}</Link>
        </Button>
      </div>
    </div>
  );
}

export default function AboutPage() {
  const locale = getServerLocale();
  return locale === "en" ? (
    <AboutLayout
      kicker="About us"
      title="Turn every product photo into a visual asset that sells"
      intro={`${BRAND} is a B2B productivity tool for e-commerce marketing, built for online sellers, brands and agencies. With advanced image generation we cut the "hard, slow, expensive" problem of producing visuals down to seconds and a few cents — turning visual output into a stable, reusable workflow.`}
      problemsLabel="The problems we solve"
      problems={[
        {
          title: "Too slow",
          desc: "Photography, retouching and designer back-and-forth — a single main image often takes days.",
        },
        {
          title: "Too expensive",
          desc: "A set of scene shots, banners and detail images can cost thousands.",
        },
        {
          title: "Hard to reuse",
          desc: "Each new season, launch or sale means starting from scratch again.",
        },
      ]}
      howLabel="How we do it"
      how={[
        {
          icon: Wand2,
          title: "A powerful generation engine",
          desc: "Text-to-image and image-to-image, preserving your product's look while rebuilding the commercial visual.",
        },
        {
          icon: LayoutGrid,
          title: "442 high-quality prompt templates",
          desc: "Main images, banners, product scenes, UI, brand logos, realistic photography, illustration and more — ready to use.",
        },
        {
          icon: Coins,
          title: "Credit-based metered billing",
          desc: "4 tiers (Free / Starter / Creator / Studio) plus one-time credit packs — pay as you go, flexible and controllable.",
        },
        {
          icon: History,
          title: "Controllable & traceable",
          desc: "Every generation is auto-archived to your gallery for download and reuse.",
        },
      ]}
      nowLabel="Where we are now"
      now={`${BRAND} is live: text-to-image / image-to-image, the template library, accounts and credits, Alipay payment, and a bilingual (Chinese / English) interface are all available. We keep refining the product — try it and send us feedback; every issue you raise is taken seriously.`}
      ctaPrimary="Try generating now"
      ctaSecondary="Contact us"
    />
  ) : (
    <AboutLayout
      kicker="关于我们"
      title="让每一张商品图，都成为能卖货的视觉资产"
      intro={`${BRAND} 是一款面向电商营销的 B2B 生产力工具，服务对象是电商卖家、品牌方与代运营团队。我们用先进的图像生成技术，把「出图难、出图慢、出图贵」这件事降到几秒钟、几块钱，让营销视觉产出变成稳定可复用的工作流。`}
      problemsLabel="我们解决什么问题"
      problems={[
        {
          title: "出图慢",
          desc: "摄影、修图、设计师沟通、来回返修，单张主图周期常以天计。",
        },
        {
          title: "成本高",
          desc: "一组场景图、Banner、详情图打包，动辄几千到上万。",
        },
        {
          title: "复用难",
          desc: "换季、上新、节日大促，又是新一轮从零开始。",
        },
      ]}
      howLabel="我们怎么做"
      how={[
        {
          icon: Wand2,
          title: "强大的图像生成引擎",
          desc: "文生图与图生图双模式，保留你的产品外观重构商业视觉。",
        },
        {
          icon: LayoutGrid,
          title: "442 个高质量提示词模板",
          desc: "覆盖电商主图、Banner、商品场景图、UI 界面、品牌标志、摄影写实、插画艺术等十余个分类，点击即用。",
        },
        {
          icon: Coins,
          title: "积分制按量计费",
          desc: "4 档会员（免费 / 入门 / 创作者 / 工作室）+ 一次性积分包，先用后付，灵活可控。",
        },
        {
          icon: History,
          title: "可控、可追溯",
          desc: "每次生成都自动归档到你的作品库，支持下载与复用。",
        },
      ]}
      nowLabel="现在的我们"
      now={`${BRAND} 已正式上线：文生图 / 图生图、模板库、账户与积分体系、支付宝支付、中英文双语界面均已可用。我们仍在持续打磨产品——欢迎试用并给我们反馈，你提的每一条问题，都会被认真对待。`}
      ctaPrimary="立即体验生成"
      ctaSecondary="联系我们"
    />
  );
}
