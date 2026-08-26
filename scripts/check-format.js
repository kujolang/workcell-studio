import fs from "node:fs";
import path from "node:path";

const roots = ["src", "frontend", "webmcp", "tests"];
let failed = false;
for (const root of roots) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (/\.(js|css|html|kujo)$/.test(entry.name)) {
        const text = fs.readFileSync(target, "utf8");
        if (/\r/.test(text) || !text.endsWith("\n")) { console.error(`${target}: invalid newline format`); failed = true; }
      }
    }
  };
  walk(root);
}
process.exitCode = failed ? 1 : 0;
