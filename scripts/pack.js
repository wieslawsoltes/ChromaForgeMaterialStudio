import { mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from './build.js';
const root = resolve(import.meta.dirname, '..'), dest = resolve(root, 'dist/packages');
build();
mkdirSync(dest, { recursive: true });
for (const name of ['core', 'geometry', 'renderer', 'paint', 'controls', 'collab']) {
    const dir = resolve(root, `packages/${name}`);
    cpSync(resolve(root, 'LICENSE'), resolve(dir, 'LICENSE'));
    for (const doc of ['SDK.md', 'FEATURES.md']) cpSync(resolve(root, 'docs', doc), resolve(dir, doc));
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--pack-destination', dest], { cwd: dir, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true', npm_config_cache: resolve(root, '.npm-cache') } });
    if (result.status !== 0) {
        console.error(result.stderr);
        process.exit(result.status ?? 1);
    }
    console.log(result.stdout.trim());
}
console.log('Created six npm-compatible tarballs. No registry publication was performed.');
