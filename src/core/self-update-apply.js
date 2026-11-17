// FSA 通道的落地实现：把 update.json + zip 写成磁盘上的新扩展。
// 这里只依赖注入进来的目录句柄，测试用内存假目录就能跑。
import { diffFiles, isSafeRelativePath } from "./self-update.js";
import { extractEntry, readZipEntries } from "./zip-extract.js";

const REQUIRED_ENTRY = "manifest.json";
// manifest.json 写坏扩展直接加载不了，失败时优先把它还原。
const GUARDED_ENTRIES = [REQUIRED_ENTRY, "src/service-worker.js"];

function fail(message) {
  throw new Error(message);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Of(handle, subtle) {
  const file = await handle.getFile();
  return toHex(await subtle.digest("SHA-256", await file.arrayBuffer()));
}

// 用户可能选错目录（比如刚清空的下载目录）。没有 manifest.json 就不是扩展目录。
export async function isExtensionDirectory(dirHandle) {
  if (!dirHandle || typeof dirHandle.getFileHandle !== "function") return false;
  try {
    await dirHandle.getFileHandle(REQUIRED_ENTRY);
    return true;
  } catch {
    return false;
  }
}

export async function readLocalHashes(dirHandle, manifest, { subtle = globalThis.crypto.subtle } = {}) {
  const hashes = {};
  // deleted 里的路径也要探一遍，否则 diffFiles 永远判不出「本地确实还留着」。
  for (const path of [...Object.keys(manifest.files), ...(manifest.deleted || [])]) {
    try {
      hashes[path] = await sha256Of(await resolveFile(dirHandle, path), subtle);
    } catch {
      // 读不到就是没这个文件，交给 diffFiles 判成需要写入。
    }
  }
  return hashes;
}

// FSA 的 getFileHandle 不认带斜杠的名字，路径得一层层走进去。
async function resolveFile(dirHandle, path) {
  const parent = await resolveParent(dirHandle, path);
  return parent.getFileHandle(path.split("/").pop());
}

async function resolveParent(dirHandle, path) {
  const parts = path.split("/");
  let current = dirHandle;
  for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part, { create: true });
  return current;
}

async function writeFileEntry(dirHandle, path, bytes) {
  const parent = await resolveParent(dirHandle, path);
  const handle = await parent.getFileHandle(path.split("/").pop(), { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
}

async function removeFileEntry(dirHandle, path) {
  const parts = path.split("/");
  let current = dirHandle;
  for (const part of parts.slice(0, -1)) {
    try {
      current = await current.getDirectoryHandle(part);
    } catch {
      return;
    }
  }
  try {
    await current.removeEntry(parts[parts.length - 1]);
  } catch {
    // 已经不在了，当作成功。
  }
}

async function readBackup(dirHandle, paths, subtle) {
  const backup = {};
  for (const path of paths) {
    try {
      const handle = await resolveFile(dirHandle, path);
      const buffer = await handle.getFile().then(file => file.arrayBuffer());
      backup[path] = { sha256: toHex(await subtle.digest("SHA-256", buffer)), bytes: buffer };
    } catch {
      // 旧扩展没有这个文件，回滚时就不需要它。
    }
  }
  return backup;
}

export async function restoreBackup(dirHandle, backup) {
  const restored = [];
  for (const [path, record] of Object.entries(backup || {})) {
    if (!isSafeRelativePath(path) || !record?.bytes) continue;
    await writeFileEntry(dirHandle, path, new Uint8Array(record.bytes));
    restored.push(path);
  }
  return restored;
}

// 写盘顺序：新增/覆盖 → 删多余 → manifest.json 收尾（diffFiles 已经把它排到最后）。
// 任何一步抛错，调用方应当拿 backup 调 restoreBackup。
export async function applyUpdate({
  dirHandle,
  zipBuffer,
  manifest,
  subtle = globalThis.crypto.subtle,
  onProgress = () => {},
  onBackup = () => {}
}) {
  if (!(await isExtensionDirectory(dirHandle))) fail("这个目录里没有 manifest.json，不是扩展目录");

  const entries = new Map(readZipEntries(zipBuffer).map(entry => [entry.path, entry]));
  const backup = await readBackup(dirHandle, GUARDED_ENTRIES, subtle);
  // 先交出去：真写到一半失败时，调用方手里已经有旧文件，可以立刻还原。
  onBackup(backup);
  const localHashes = await readLocalHashes(dirHandle, manifest, { subtle });
  const { write, remove } = diffFiles(localHashes, manifest);

  const payload = new Map();
  for (const path of Object.keys(manifest.files)) {
    if (!isSafeRelativePath(path)) fail(`update.json 里有不安全的路径：${path}`);
    const entry = entries.get(path);
    if (!entry) fail(`更新包里缺少 ${path}`);
    const bytes = await extractEntry(zipBuffer, entry);
    const actual = toHex(await subtle.digest("SHA-256", bytes));
    if (actual !== manifest.files[path]) fail(`更新包里 ${path} 的摘要对不上，已中止`);
    payload.set(path, bytes);
  }

  // 普通文件先写，删除次之，manifest.json 最后——中途断电时旧清单还在，扩展至少能加载。
  const guarded = write.filter(path => GUARDED_ENTRIES.includes(path));
  const regular = write.filter(path => !GUARDED_ENTRIES.includes(path));

  const written = [];
  for (const path of regular) {
    onProgress({ phase: "write", path, done: written.length, total: write.length });
    await writeFileEntry(dirHandle, path, payload.get(path));
    written.push(path);
  }

  const removed = [];
  for (const path of remove) {
    await removeFileEntry(dirHandle, path);
    removed.push(path);
  }

  for (const path of guarded) {
    onProgress({ phase: "write", path, done: written.length + removed.length, total: write.length });
    await writeFileEntry(dirHandle, path, payload.get(path));
    written.push(path);
  }

  return { written, removed, backup };
}
