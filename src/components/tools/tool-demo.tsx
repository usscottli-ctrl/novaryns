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
// 两种演示形式(配其一即可):
//   combo  = 一张「前后合成图」(左原/右效果,或左效果/右原),单图就能说清效果;
//   before/after = 分开的两张图,组件自动拼成「原图 → 效果」。
// 都没配则只显示标题 + 干净提示(不放假图)。
export const TOOL_DEMOS: Record<
  string,
  {
    title: string;
    combo?: string;
    before?: string;
    after?: string;
    gallery?: string[];
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
  inpaint: {
    title: "圈出要改的地方,描述一下就重绘",
    before: "/demos/inpaint-before.webp",
    after: "/demos/inpaint-after.webp",
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
  };
}

export function ToolDemo({
  title,
  combo,
  before,
  after,
  gallery,
}: {
  title: string;
  combo?: string;
  before?: string;
  after?: string;
  gallery?: string[];
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const hasPair = !!before && !!after;
  return (
    <div className="flex flex-1 flex-col items-center justify-start gap-6 px-4 pb-8 pt-10 text-center">
      <h3 className="max-w-[90%] text-[18px] font-bold leading-snug text-acc sm:text-[21px]">
        {title}
      </h3>
      {gallery?.length ? (
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
