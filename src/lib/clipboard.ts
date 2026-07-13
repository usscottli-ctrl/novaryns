// 复制到剪贴板,带 HTTP(非安全上下文)兜底。
// `navigator.clipboard` 只在安全上下文(HTTPS / localhost)存在;裸 IP 走 HTTP 的
// 自托管站没有它,直接用会静默失败。此时退回老的 execCommand('copy') + 临时 textarea。
// 返回是否成功,调用方据此提示。
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 安全上下文里也可能因权限/焦点失败 → 落到兜底 */
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
