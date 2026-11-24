import * as rust from "./rust-shim.js";

export function stripModelDecoration(value) {
  return rust.stripModelDecoration(value);
}

export function bareModelSpelling(id) {
  return rust.bareModelSpelling(id);
}

export function canonicalModelKey(value) {
  return rust.canonicalModelKey(value);
}
