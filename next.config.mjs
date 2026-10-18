/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone 输出:Docker 镜像用(.next/standalone 自带精简 node_modules)。
  // 服务器上 `next start` 不受影响,两种运行方式共存。
  output: "standalone",
  // 原生模块(含 .node 二进制)不能被 webpack 打包,标记为服务端外部依赖,
  // 运行时直接 require。sharp 是原生模块(图像缩放,generate-image 用)。
  experimental: {
    serverComponentsExternalPackages: ["sharp", "geoip-lite"],
  },
  // geoip-lite 是**可选依赖**(访问统计解析访客国家,自带几十 MB 数据文件)。
  // 只写 serverComponentsExternalPackages 不够 —— webpack 仍会在编译期解析模块,
  // 包没装就直接 "Module not found" 让整个 build 挂掉。加进 externals 才是真正
  // 「不解析、运行时才 require」,于是:装了 → 有国家数据;没装 → 采集端点里的
  // try/catch 吞掉,国家记 null,其余统计照常,开源版/精简 Docker 镜像不受影响。
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "geoip-lite"];
    }
    return config;
  },
};

export default nextConfig;
