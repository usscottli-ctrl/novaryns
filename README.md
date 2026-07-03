<div align="center">

# Novaryns

**开源 AI 电商生图网站 — 生图 / 套图 / 抠图 / 试穿 / 画布,一站式出商业级商品图**

Open-source AI e-commerce visual studio — generate, batch-suite, cut out, try on and canvas-compose production-ready product images.

[快速开始](#-快速开始--quick-start) · [功能](#-功能--features) · [版本](#-版本--editions) · [License](#-license)

</div>

---

## ✨ 功能 / Features

- **AI 生图** — 文生图 / 图生图,电商风格化提示词体系,1K/2K/4K
- **一键套图** — 上传产品图,自动产出 1 主图 + 4 副图 + 8 详情图整套素材
- **18 款图像工具** — 发丝级抠图、高清放大、局部改图、风格转换、服装平铺提取、3D 展示、虚拟试穿、去皱、去水印、印花提取、侵权检测、爆款标题……
- **创作画布** — React Flow 血缘画布,每张图的来源与迭代一目了然
- **对话生图** — 聊天式改图,一句话继续迭代
- **完整后台** — 模板库、提示词配置、API Key 管理(浏览器 RSA 加密 + AES 落库)
- **国际化** — 中 / 英双语,按浏览器语言自动切换

## 🚀 快速开始 / Quick start

一行命令(需 Docker):

```bash
curl -fsSL https://raw.githubusercontent.com/usscottli-ctrl/novaryns/main/install.sh | bash
```

或手动:

```bash
git clone https://github.com/usscottli-ctrl/novaryns && cd novaryns
docker compose up -d
```

打开 **http://localhost:3000** — 首启配置向导会引导你填入 OpenAI API Key(必填)、Pro License Key(选填)与站点名称,填完即用,**无需改任何代码或配置文件**。

> 不知道 API Key 怎么获取?可联系作者微信 **xingze063**,或付费由作者代为提供 / 配置。

Compose 自带 Postgres 与持久化数据卷;生成的图片默认存本地磁盘(`/data/media`),配置 Cloudflare R2 后自动切对象存储。手动部署(`npm run build && npm start`)见 [.env.example](.env.example)。

## 📦 版本 / Editions

| | 开源版 Community | Pro 自托管 | 云端托管 Cloud |
|---|---|---|---|
| 价格 | **¥0**(AGPL-3.0) | **¥1,999/年起** | **¥3,999/年起** |
| 全部生成与图像工具 | ✅ | ✅ | ✅ |
| 创作画布 / 对话生图 | ✅ | ✅ | ✅ |
| 自带 API Key · 单机自用 | ✅ | ✅ | 含算力积分 |
| 白标(自有品牌/去署名) | — | ✅ | ✅ |
| 多用户注册 / 团队 | — | ✅ | ✅ |
| 收银台(支付宝/微信直收) | — | ✅ | ✅ |
| 运营后台高阶(用户/发卡/流水) | — | ✅ | ✅ |
| 商业授权(可闭源自用) | AGPL 义务 | ✅ | ✅ |
| 部署 | 自部署 | 自部署 + License Key | **免运维,专属实例 + 自有域名** |

购买 Pro 授权 / 开通云端托管:加作者微信 **xingze063**。

## 🧱 技术栈 / Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · PostgreSQL · OpenAI Images API · Replicate(抠图/放大) · Cloudflare R2(可选)

## 📄 License

本项目以 **AGPL-3.0** 开源:你可以自由使用、修改、自部署;若基于本项目对外提供网络服务,须以同等许可开源你的修改。**不希望受 AGPL 约束的商业闭源使用,请购买 Pro 商业授权**(微信 xingze063)。

Licensed under **AGPL-3.0**. If you run a modified version as a network service you must open-source your modifications under the same license — or purchase a commercial Pro license instead.

---

<div align="center">
Made with ❤️ by the <b>Novaryns</b> team · WeChat <b>xingze063</b>
</div>
