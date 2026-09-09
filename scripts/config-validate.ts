import { readFile } from "node:fs/promises";
import { validateConfigDocument } from "../src/runtime-config.js";

const filename = process.argv[2];
if (!filename) throw new Error("用法：npm run config:validate -- path/to/config.json");
let value: unknown;
try { value = JSON.parse(await readFile(filename, "utf8")); } catch { throw new Error("配置文件必须是 UTF-8 JSON"); }
validateConfigDocument(value);
console.log(`配置校验通过：${filename}`);
