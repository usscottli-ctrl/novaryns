// geoip-lite 是**可选依赖**(package.json optionalDependencies):装了 → 访问统计能
// 解析出访客国家;没装 → 采集端点里的 import 被 try/catch 吞掉,国家记为 null,
// 其余统计照常。这份声明让 tsc / next build 在「包没装」的机器上也能通过。
declare module "geoip-lite" {
  export interface GeoipRecord {
    range?: [number, number];
    country?: string; // ISO 3166-1 alpha-2,如 CN / US
    region?: string;
    city?: string;
    timezone?: string;
  }
  export function lookup(ip: string): GeoipRecord | null;
  const geoip: { lookup: typeof lookup };
  export default geoip;
}
