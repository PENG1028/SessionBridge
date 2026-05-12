const { readdirSync, statSync, copyFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const srcDir = join(__dirname, '..', 'extensions');
const dstDir = join(__dirname, '..', 'dist', 'extensions');

if (!existsSync(dstDir)) {
  process.exit(0);
}

let count = 0;
for (const name of readdirSync(srcDir)) {
  const srcPath = join(srcDir, name, 'sb-extension.json');
  const subDir = join(srcDir, name);
  if (statSync(subDir).isDirectory() && existsSync(srcPath)) {
    const dstSubDir = join(dstDir, name);
    mkdirSync(dstSubDir, { recursive: true });
    copyFileSync(srcPath, join(dstSubDir, 'sb-extension.json'));
    count++;
  }
}

if (count > 0) console.log(`[copy-manifests] Copied ${count} extension manifest(s) to dist/extensions/`);
