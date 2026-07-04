// 开源版单用户模式下的默认操作者身份。
// 客户端(auth-form 登录后 signIn 用它建 mock 用户)与服务端(resolveUserEmail 认到
// 本地管理员 cookie 时返回它)共用同一个值,保证前后端一致。纯常量,前后端都可 import。
export const OPERATOR_EMAIL = "operator@novaryns.local";
