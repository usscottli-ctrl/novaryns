"use client";

import { ImageIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";
import { cdnUrl } from "@/lib/cdn";

/**
 * 功能页空态演示:中间显示「原图 → 效果」一对图 + 一句功能标题,
 * 让用户一进页面就明白这个工具是做什么的(对标同行)。
 *
 * 素材策略:每个工具配「真实的」一对 before/after(贴合该功能)才显示对比图;
 * 没配真实图的工具,只显示功能标题 + 干净提示(不放假图,避免误导)。
 * 真实图填进对应工具的 before/after 即可(传 R2 后的 URL)。
 */

// 每个工具的演示配置:title=功能标题。
// 几种演示形式(配其一即可):
//   combo  = 一张「前后合成图」(左原/右效果,或左效果/右原),单图就能说清效果;
//   before/after = 分开的两张图,组件自动拼成「原图 → 效果」;
//   steps  = 三步及以上的流程图,每张自带图注(局部改图这种「原图→涂抹→生成」
//            两张说不清的工具用它,否则用户看不懂中间那张蓝色的是什么);
//   gallery = 若干张平铺,不带图注和箭头。
// 都没配则只显示标题 + 干净提示(不放假图)。
export type DemoStep = { src: string; zh: string; en: string };

export const TOOL_DEMOS: Record<
  string,
  {
    title: string;
    combo?: string;
    before?: string;
    after?: string;
    gallery?: string[];
    steps?: DemoStep[];
  }
> = {
  upscale: {
    title: "模糊图、老照片,一键高清修复放大",
    before: "/demos/upscale-before.webp",
    after: "/demos/upscale-after.webp",
  },
  cutout: { title: "一键抠出主体,发丝级透明底", combo: "/demos/cutout-combo.png" },
  style: {
    title: "一张图,秒换全新画面风格",
    before: "/demos/style-before.webp",
    after: "/demos/style-after.webp",
  },
  garment: {
    title: "模特图,自动提取成平铺电商主图",
    before: "/demos/garment-before.webp",
    after: "/demos/garment-after.webp",
  },
  dress3d: {
    title: "平铺服装,一键生成 3D 立体效果",
    before: "/demos/dress3d-before.webp",
    after: "/demos/dress3d-after.webp",
  },
  dewrinkle: {
    title: "褶皱衣服,一键熨平成精致质感",
    before: "/demos/dewrinkle-before.webp",
    after: "/demos/dewrinkle-after.webp",
  },
  avatar: { title: "普通照片,秒变精致 AI 头像" },
  print: {
    title: "成品图上的印花,一键提取成素材",
    before: "/demos/print-before.webp",
    after: "/demos/print-after.webp",
  },
  variation: {
    title: "一张图,裂变出整组系列素材",
    before: "/demos/variation-before.webp",
    after: "/demos/variation-after.webp",
  },
  fusion: {
    title: "多图元素,融合成无缝视觉合成",
    before: "/demos/fusion-before.webp",
    after: "/demos/fusion-after.webp",
  },
  // 局部改图必须三步:只给「原图→效果」的话,用户不知道中间要自己涂抹选区。
  inpaint: {
    title: "圈出要改的地方,描述一下就重绘",
    steps: [
      { src: "/demos/inpaint-step1.webp", zh: "原图", en: "Original" },
      { src: "/demos/inpaint-step2.webp", zh: "涂抹要改的区域", en: "Brush the area" },
      { src: "/demos/inpaint-step3.webp", zh: "生成结果", en: "Result" },
    ],
  },
  printfile: {
    title: "上传图,一键生成印刷级文件",
    before: "/demos/printfile-before.webp",
    after: "/demos/printfile-after.webp",
  },
  tryon: {
    title: "模特 + 服装,一键虚拟试穿上身",
    before: "/demos/tryon-before.webp",
    after: "/demos/tryon-after.webp",
  },
  titles: {
    title: "看图识卖点,一键出爆款营销标题",
    before: "/demos/titles-before.webp",
    after: "/demos/titles-after.webp",
  },
  image: {
    title: "一句话或产品图,生成电商大片",
    before: "/demos/image-before.webp",
    after: "/demos/image-after.webp",
  },
  suite: {
    title: "上传产品图,自动出整套电商套图",
    before: "/demos/suite-before.webp",
    after: "/demos/suite-after.webp",
  },
  ipcheck: {
    title: "看图识别版权 / IP 侵权风险",
    gallery: [
      "/demos/ipcheck-1.webp",
      "/demos/ipcheck-2.webp",
      "/demos/ipcheck-3.webp",
    ],
  },
  dewatermark: {
    title: "一键擦除水印 / logo / 文字,自然补全",
    before: "/demos/dewatermark-before.webp",
    after: "/demos/dewatermark-after.webp",
  },
};

/** 取某工具的演示配置。combo / before/after 都可能为空(未配真实图)。 */
export function getDemo(key?: string) {
  if (!key) return null;
  const d = TOOL_DEMOS[key];
  if (!d) return null;
  return {
    title: d.title,
    combo: d.combo,
    before: d.before,
    after: d.after,
    gallery: d.gallery,
    steps: d.steps,
  };
}

/** 步骤之间的箭头。size 跟着容器走,三步比两步窄,所以小一号。 */
function StepArrow({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ToolDemo({
  title,
  combo,
  before,
  after,
  gallery,
  steps,
}: {
  title: string;
  combo?: string;
  before?: string;
  after?: string;
  gallery?: string[];
  steps?: DemoStep[];
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const hasPair = !!before && !!after;
  return (
    <div className="flex flex-1 flex-col items-center justify-start gap-6 px-4 pb-8 pt-10 text-center">
      <h3 className="max-w-[90%] text-[18px] font-bold leading-snug text-acc sm:text-[21px]">
        {title}
      </h3>
      {steps?.length ? (
        // 三图并排:中间栏可用宽约 480px,所以单图上限 128 —— 3×128 + 2 个箭头 + 间距
        // ≈ 470,刚好不溢出(两图版用的是 220,那是两张图的预算,不能照搬)。
        // 行用 items-center,箭头就自然竖直居中,不要手写 margin 去凑。
        <div className="flex w-full items-center justify-center gap-1.5 sm:gap-2.5">
          {steps.map((s, i) => (
            <div key={s.src} className="flex items-center gap-1.5 sm:gap-2.5">
              {i > 0 && (
                // 箭头要对准**图片**的竖直中心,而不是 figure 的中心 —— 图注预留了两行,
                // 按 figure 居中会让箭头偏低十几像素。图高恒为宽的 1.5 倍,所以半高 =
                // 0.75×宽,再减去箭头自身半高;跟着 clamp 自动缩放。
                <StepArrow
                  className="h-5 w-5 flex-none self-start text-acc sm:h-6 sm:w-6
                    mt-[calc(0.75*clamp(72px,18vw,128px)-10px)]
                    sm:mt-[calc(0.75*clamp(72px,18vw,128px)-12px)]"
                />
              )}
              <figure className="flex shrink-0 flex-col items-center gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cdnUrl(s.src)}
                  alt={L(s.zh, s.en)}
                  className={
                    // 最后一步 = 结果,用强调色描边跟前面的过程图区分开
                    "aspect-[2/3] w-[clamp(72px,18vw,128px)] rounded-2xl bg-c-subtle2 object-contain shadow-card " +
                    (i === steps.length - 1
                      ? "border-2 border-acc"
                      : "border border-c-border")
                  }
                />
                <figcaption
                  className={
                    // 预留两行高度:窄屏下「涂抹要改的区域」会折行,不预留的话那一列更高,
                    // 行的 items-center 就会把这张图顶得比旁边高几像素。
                    "min-h-[2.5em] max-w-[clamp(72px,18vw,128px)] text-[11px] leading-tight sm:text-[11.5px] " +
                    (i === steps.length - 1
                      ? "font-medium text-acc"
                      : "text-c-text3")
                  }
                >
                  {L(s.zh, s.en)}
                </figcaption>
              </figure>
            </div>
          ))}
        </div>
      ) : gallery?.length ? (
        <div className="flex w-full items-stretch justify-center gap-2 sm:gap-3">
          {gallery.map((g, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={cdnUrl(g)}
              alt=""
              className="w-[clamp(88px,28vw,180px)] rounded-2xl border border-c-border bg-c-subtle2 object-contain shadow-card"
            />
          ))}
        </div>
      ) : combo ? (
        <div className="w-full max-w-[460px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl(combo)}
            alt={title}
            className="w-full rounded-2xl border border-c-border object-contain shadow-card"
          />
        </div>
      ) : hasPair ? (
        <div className="flex w-full items-center justify-center gap-3 sm:gap-5">
          <figure className="flex shrink-0 flex-col items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cdnUrl(before!)}
              alt={L("原图", "Original")}
              className="aspect-square w-[clamp(110px,34vw,220px)] rounded-2xl border border-c-border bg-c-subtle2 object-contain shadow-card"
            />
            <figcaption className="text-[11.5px] text-c-text3">{L("原图", "Original")}</figcaption>
          </figure>
          <svg
            className="h-8 w-8 flex-none text-acc sm:h-10 sm:w-10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          <figure className="flex shrink-0 flex-col items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cdnUrl(after!)}
              alt={L("效果", "Result")}
              className="aspect-square w-[clamp(110px,34vw,220px)] rounded-2xl border-2 border-acc bg-c-subtle2 object-contain shadow-card"
            />
            <figcaption className="text-[11.5px] font-medium text-acc">
              {L("效果", "Result")}
            </figcaption>
          </figure>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5 text-c-text3">
          <ImageIcon className="h-9 w-9 text-c-text4" />
          <p className="text-[13px]">{L("上传左侧图片,马上体验", "Upload an image on the left to try it")}</p>
        </div>
      )}
    </div>
  );
}
