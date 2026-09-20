import { mkdirSync, writeFileSync, cpSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { build } from './build.js';
const root = resolve(import.meta.dirname, '..');
const site = resolve(root, 'dist/site');
build();
writeFileSync(resolve(site, '.nojekyll'), '');
mkdirSync(resolve(site, 'downloads'), { recursive: true });
cpSync(resolve(root, 'dist/ChromaForge-Standalone.html'), resolve(site, 'downloads/ChromaForge-Standalone.html'));
writeFileSync(resolve(site, 'build-info.json'), JSON.stringify({
    name: 'ChromaForge Material Studio',
    version: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
    commit: process.env.GITHUB_SHA || null,
    repository: process.env.GITHUB_REPOSITORY || 'wieslawsoltes/ChromaForgeMaterialStudio',
    hosting: 'static',
    collaborationServiceHosted: false
}, null, 2) + '\n');
// Check every local HTML resource/link after the subdirectory-safe build.
function check(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, item.name);
        if (item.isDirectory()) { check(path); continue; }
        if (!item.name.endsWith('.html')) continue;
        const html = readFileSync(path, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>');
        for (const [, url] of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
            if (/^(?:[a-z]+:|#|\/\/)/i.test(url) || url.includes('${')) continue;
            if (url.startsWith('/')) throw new Error(`Root-relative Pages URL: ${url} in ${relative(site, path)}`);
            const file = url.split(/[?#]/)[0];
            if (!file) continue;
            const target = resolve(dirname(path), file);
            if (!target.startsWith(site + '/') && target !== site) throw new Error(`Link escapes Pages output: ${url}`);
            if (!existsSync(target)) throw new Error(`Missing Pages target: ${url} in ${relative(site, path)}`);
        }
    }
}
check(site);
console.log('Pages output built; repository-relative HTML links and resources verified.');
