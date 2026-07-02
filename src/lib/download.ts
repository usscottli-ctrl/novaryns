// Triggers a real file download. Cross-origin (R2) URLs go through the
// same-origin /api/download proxy so the browser saves instead of navigating;
// data: URLs download directly. Credits are NOT touched — this only retrieves
// an already-generated, already-stored image.
export function downloadImage(url: string, baseName: string) {
  const name =
    (baseName || `novaryns-${Date.now()}`).replace(/[^\w.\-]+/g, "_") +
    ".png";
  const a = document.createElement("a");
  if (url.startsWith("data:")) {
    a.href = url;
  } else {
    a.href = `/api/download?u=${encodeURIComponent(
      url
    )}&n=${encodeURIComponent(name)}`;
  }
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
