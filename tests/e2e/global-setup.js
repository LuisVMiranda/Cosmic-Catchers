import { execFileSync } from "node:child_process";
import path from "node:path";

export default function globalSetup() {
  const root = path.resolve(import.meta.dirname, "../..");
  execFileSync(process.execPath, [path.join(root, "scripts", "build.mjs"), "--test"], {
    cwd: root,
    stdio: "inherit"
  });
}
