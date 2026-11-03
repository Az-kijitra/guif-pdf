// Regenerates ../THIRD_PARTY_NOTICES.md from the locked dependency trees: `npm run notices`.
// Node built-ins only.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(APP, "..", "THIRD_PARTY_NOTICES.md");

function npmPackages() {
  const dirs = execSync("npm ls --omit=dev --all --parseable", { cwd: APP, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1);
  const packages = new Map();
  for (const dir of dirs) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, version, license } = JSON.parse(readFileSync(manifest, "utf8"));
    packages.set(`${name}@${version}`, { name, version, license: license ?? "不明" });
  }
  return [...packages.values()];
}

function cargoPackages() {
  const metadata = JSON.parse(
    execSync("cargo metadata --format-version 1 --locked --filter-platform x86_64-pc-windows-msvc", {
      cwd: join(APP, "src-tauri"),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
    })
  );
  const used = new Set(metadata.resolve.nodes.map((node) => node.id));
  return metadata.packages
    .filter((p) => used.has(p.id) && p.name !== "guif-pdf")
    .map((p) => ({ name: p.name, version: p.version, license: p.license ?? "不明" }));
}

const table = (packages) =>
  [
    "| パッケージ | 版 | ライセンス |",
    "| :--- | :--- | :--- |",
    ...packages
      .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
      .map((p) => `| ${p.name} | ${p.version} | ${p.license} |`),
  ].join("\n");

const text = `# Third-party notices

guif-pdf 本体は [MIT License](LICENSE) です。次のソフトウェアとデータを同梱または利用しています。それぞれの著作権は各権利者にあり、各ライセンスに従います。

このファイルは \`npm run notices\` で生成します。

## PDF の表示に使うデータ

インストーラーに含まれ、ライセンスの全文も次の場所に同梱しています。

| データ | 権利者 | ライセンス | 全文の場所 |
| :--- | :--- | :--- | :--- |
| CMap リソース | Adobe Systems Incorporated | BSD-3-Clause | \`pdfjs/cmaps/LICENSE\` |
| 標準フォント（Foxit 系） | PDFium Authors | BSD-3-Clause | \`pdfjs/standard_fonts/LICENSE_FOXIT\` |
| 標準フォント（Liberation） | Google Corporation、Red Hat, Inc. ほか | SIL Open Font License 1.1 | \`pdfjs/standard_fonts/LICENSE_LIBERATION\` |

## npm パッケージ（配布物に含まれるもの）

${table(npmPackages())}

## Rust クレート（Windows 版のビルドに使うもの）

${table(cargoPackages())}
`;

writeFileSync(OUTPUT, text);
console.log(`wrote ${OUTPUT}`);
