// Copies the built plugin into a vault: VAULT=/path/to/vault npm run install:vault
import { copyFileSync, mkdirSync } from "fs";
import { join } from "path";

const vault = process.env.VAULT;
if (!vault) {
  console.error("Set VAULT=/path/to/your/vault");
  process.exit(1);
}
const dir = join(vault, ".obsidian", "plugins", "questlog");
mkdirSync(dir, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, join(dir, f));
console.log(`Installed into ${dir}`);
