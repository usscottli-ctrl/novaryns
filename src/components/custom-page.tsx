// 站长自定义页面渲染(关于我们 / 联系我们 / 定价)。
// 纯文本按段落 + 换行安全渲染(React 默认转义,天然防 XSS),保留空行分段。
export function CustomPage({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  // 用空行切分段落,段内保留换行(whitespace-pre-line)。
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      <div className="mt-6 space-y-4">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className="whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground"
          >
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}
