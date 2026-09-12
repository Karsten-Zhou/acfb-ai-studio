// download themes to src\shikithemes

import fs from "fs";
import path from "path";
import { parse } from "jsonc-parser";

const links = [
  "https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-defaults/themes/2026-dark.json",
  "https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-defaults/themes/2026-light.json",
];

async function downloadThemes() {
  for (const link of links) {
    const response = await fetch(link);
    if (!response.ok) {
      throw new Error(`Failed to download ${link}: ${response.statusText}`);
    }
    const data = await response.text();
    const { tokenColors, ...rest } = parse(data);

    // preprocess
    const parsed = { ...rest, settings: tokenColors };
    delete parsed.include;
    delete parsed.$schema;

    const fileName = path.basename(link);
    const filePath = path.join("src", "shikithemes", fileName);
    fs.writeFileSync(filePath, JSON.stringify(parsed));
    console.log(`Downloaded and saved ${fileName}`);
  }
}

downloadThemes();
