import { SuiteClient } from "@/components/suite/suite-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `A+详情 — ${BRAND}` };

// 亚马逊 A+ 页面模块图:复用一键套图的流程(上传→设计方向→出图→记录),只出 A+ 横版模块
export default function AplusPage() {
  return <SuiteClient mode="aplus" />;
}
