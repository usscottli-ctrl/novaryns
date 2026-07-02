import {
  isWechatEnabled,
  verifyWxSignature,
  xmlField,
  markWxScan,
} from "@/lib/wechat";

// 微信公众号「服务器配置」指向的回调端点(明文模式)。
// GET  = 微信验证服务器有效性(原样回 echostr)。
// POST = 事件/消息推送:扫带参二维码(subscribe 带 qrscene_ 前缀 / 已关注 SCAN)
//        → 把 openid 写进对应登录会话;顺手回一条文本,别让公众号变哑巴
//        (启用服务器配置后,后台自带的自动回复会失效,由这里代答)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function xmlReply(toOpenid: string, fromGh: string, content: string): Response {
  const xml = `<xml><ToUserName><![CDATA[${toOpenid}]]></ToUserName><FromUserName><![CDATA[${fromGh}]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content></xml>`;
  return new Response(xml, { headers: { "content-type": "text/xml" } });
}

// 微信要求 5 秒内应答;回 "success" 表示收到但不回复内容。
const ack = () => new Response("success");

export async function GET(req: Request) {
  if (!(await isWechatEnabled())) return new Response("not configured", { status: 503 });
  const sp = new URL(req.url).searchParams;
  if (!(await verifyWxSignature(sp))) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(sp.get("echostr") ?? "");
}

export async function POST(req: Request) {
  if (!(await isWechatEnabled())) return new Response("not configured", { status: 503 });
  const sp = new URL(req.url).searchParams;
  if (!(await verifyWxSignature(sp))) {
    return new Response("forbidden", { status: 403 });
  }
  const xml = await req.text();
  const openid = xmlField(xml, "FromUserName");
  const ghId = xmlField(xml, "ToUserName"); // 公众号原始 ID,回复时对调
  const msgType = xmlField(xml, "MsgType");

  if (msgType === "event" && openid) {
    const event = xmlField(xml, "Event").toLowerCase();
    const key = xmlField(xml, "EventKey");
    // 扫带参二维码:未关注→subscribe + qrscene_<sid>;已关注→SCAN + <sid>
    const sid =
      event === "subscribe" && key.startsWith("qrscene_")
        ? key.slice("qrscene_".length)
        : event === "scan"
          ? key
          : "";
    if (sid && markWxScan(sid, openid)) {
      return xmlReply(openid, ghId, "✅ 登录成功!回到电脑上,马上开始创作吧。");
    }
    if (event === "subscribe") {
      return xmlReply(
        openid,
        ghId,
        "欢迎关注星泽商图 🎉 AI 一键生成电商主图/套图/抠图,电脑访问 ai.starzeco.com 即刻体验。"
      );
    }
    return ack();
  }

  // 普通消息(粉丝发文字等):固定简短回复,避免完全无响应
  if (msgType === "text" && openid) {
    return xmlReply(
      openid,
      ghId,
      "感谢留言!产品入口:ai.starzeco.com(AI 电商视觉工作台)。"
    );
  }
  return ack();
}
