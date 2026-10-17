import { getValue, setValue, validateImportedState } from "./db.js";

export const WORKSPACE_FILE_NAME = "ai-price-analyzer.workspace.json";
const WORKSPACE_HANDLE_KEY = "workspace:directory-handle";
const WORKSPACE_FORMAT = "ai-price-analyzer-workspace";
const WORKSPACE_VERSION = 1;

let workspaceOperation = Promise.resolve();

export function enqueueWorkspaceOperation(operation) {
  const next = workspaceOperation.then(operation, operation);
  workspaceOperation = next.catch(() => {});
  return next;
}
export function isWorkspaceSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

async function hasPermission(handle, request) {
  if (!handle || typeof handle.getFileHandle !== "function") return false;
  const mode = "readwrite";
  const current = typeof handle.queryPermission === "function"
    ? await handle.queryPermission({ mode })
    : "granted";
  if (current === "granted") return true;
  if (!request || typeof handle.requestPermission !== "function") return false;
  return (await handle.requestPermission({ mode })) === "granted";
}

export async function getStoredWorkspace() {
  const handle = await getValue(WORKSPACE_HANDLE_KEY);
  return await hasPermission(handle, false) ? handle : null;
}

export async function pickWorkspace() {
  if (!isWorkspaceSupported()) throw new Error("当前浏览器不支持本地工作区，请使用 JSON 导入导出");
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  if (!(await hasPermission(handle, true))) throw new Error("没有获得工作区读写权限");
  await setValue(WORKSPACE_HANDLE_KEY, handle);
  return handle;
}

export function parseWorkspaceState(document) {
  const isWorkspaceDocument = document?.format === WORKSPACE_FORMAT;
  if (isWorkspaceDocument && document.version !== WORKSPACE_VERSION) throw new Error("工作区文件版本不受支持");
  const state = isWorkspaceDocument ? document.state : document;
  if (!state || typeof state !== "object" || Array.isArray(state) || !Array.isArray(state.stations)) throw new Error("工作区数据格式不正确");
  validateImportedState(state);
  return state;
}

export async function readWorkspace(handle) {
  if (!(await hasPermission(handle, false))) throw new Error("工作区权限已失效，请重新选择目录");
  let fileHandle;
  try {
    fileHandle = await handle.getFileHandle(WORKSPACE_FILE_NAME);
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    throw error;
  }
  let text;
  try {
    text = await (await fileHandle.getFile()).text();
  } catch (error) {
    throw new Error(`无法读取工作区文件：${error.message || String(error)}`);
  }
  try {
    return parseWorkspaceState(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("工作区文件不是有效 JSON");
    throw error;
  }
}

export async function writeWorkspace(handle, state) {
  if (!(await hasPermission(handle, false))) throw new Error("工作区权限已失效，请重新选择目录");
  const fileHandle = await handle.getFileHandle(WORKSPACE_FILE_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  const document = { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, updatedAt: Date.now(), state };
  try {
    await writable.write(`${JSON.stringify(document, null, 2)}\n`);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    throw new Error(`无法写入工作区文件：${error.message || String(error)}`);
  }
}
