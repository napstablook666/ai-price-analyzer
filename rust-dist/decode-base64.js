// 由 scripts/rust-build.mjs 生成，不要手改。base64 → Uint8Array，给内联的 wasm 字节用。
export function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
