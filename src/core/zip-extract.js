// 只认扩展自己发的那种 zip：deflate 或 stored，不带 zip64、不带加密。
// 够用就行，不引第三方解压库。
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;

function fail(message) {
  throw new Error(message);
}

function findEndOfCentralDirectory(view) {
  const floor = Math.max(0, view.byteLength - EOCD_MIN_BYTES - 0xffff);
  for (let offset = view.byteLength - EOCD_MIN_BYTES; offset >= floor; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function decodeName(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

// 返回 [{ path, method, compressedSize, size, dataOffset }]，目录项直接丢掉。
export function readZipEntries(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) fail("更新包不是合法的 zip（找不到中央目录）");

  const total = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || directoryOffset === 0xffffffff) fail("更新包用了 zip64，暂不支持");

  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > bytes.byteLength) fail("更新包的中央目录被截断");
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) fail("更新包的中央目录项签名不对");

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail("更新包用了 zip64，暂不支持");

    // Windows 打包工具会写反斜杠，统一成 web 路径再交给后续校验。
    const path = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength)).replace(/\\/g, "/");
    cursor += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith("/")) continue;
    if (localOffset + 30 > bytes.byteLength) fail(`更新包里 ${path} 的本地头越界`);
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) fail(`更新包里 ${path} 的本地头签名不对`);

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    entries.push({
      path,
      method,
      compressedSize,
      size,
      dataOffset: localOffset + 30 + localNameLength + localExtraLength
    });
  }
  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") fail("当前浏览器不支持 DecompressionStream，请手动下载更新");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function extractEntry(buffer, entry) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const raw = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method !== 8) fail(`更新包里 ${entry.path} 用了不支持的压缩方式 ${entry.method}`);
  const inflated = await inflateRaw(raw);
  if (entry.size && inflated.length !== entry.size) fail(`更新包里 ${entry.path} 解压后长度不对`);
  return inflated;
}

// 解出 { 路径: 字节 }，重复路径直接判错——正常发版不会出现。
export async function extractZip(buffer) {
  const files = new Map();
  for (const entry of readZipEntries(buffer)) {
    if (files.has(entry.path)) fail(`更新包里 ${entry.path} 出现了两次`);
    files.set(entry.path, await extractEntry(buffer, entry));
  }
  return files;
}
