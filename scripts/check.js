import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
let count = 0;
function visit(path) { for (const item of readdirSync(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'data', '.git', '.npm-cache'].includes(item.name))
        continue;
    const file = join(path, item.name);
    if (item.isDirectory())
        visit(file);
    else if (/\.(m?js)$/.test(file)) {
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        if (result.status !== 0) {
            console.error(result.stderr);
            process.exit(1);
        }
        count++;
    }
} }
visit(root);
for (const name of ['core', 'geometry', 'renderer', 'paint', 'controls', 'collab']) {
    const p = JSON.parse(readFileSync(join(root, `packages/${name}/package.json`), 'utf8'));
    if (p.name !== `@chromaforge/${name}` || p.exports?.['.']?.import !== './dist/index.js')
        throw Error(`Invalid package export: ${name}`);
}
console.log(`Checked ${count} JavaScript files and six package export manifests.`);
