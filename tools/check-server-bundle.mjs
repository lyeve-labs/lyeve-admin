// The runtime image carries build/ and no node_modules, so every package the
// server imports has to be inside build/. adapter-node bundles devDependencies
// and leaves dependencies as bare imports for a node_modules it assumes will be
// installed, and Vite keeps plain JavaScript packages external unless told
// otherwise. A server module that imports one of those builds cleanly and then
// fails the first request that loads it, with ERR_MODULE_NOT_FOUND.
//
// This reads the server half of build/ for static imports of a bare package
// name. A Node builtin is fine. A dynamic import is not read, because the
// framework uses it for optional packages it catches the absence of.
//
//   node tools/check-server-bundle.mjs [build-dir]

import { globSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILTINS = new Set(builtinModules);

const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

/** The package a specifier names, or null when it is relative or a builtin. */
export function externalPackage(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  if (specifier.startsWith('#')) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return BUILTINS.has(name) ? null : name;
}

/** Every package the source imports statically that it does not carry. */
export function externalImports(source) {
  const found = new Set();
  for (const match of source.matchAll(STATIC_IMPORT)) {
    const name = externalPackage(match[1]);
    if (name) found.add(name);
  }
  return [...found].sort();
}

/** The server files under dir that import an external package, by file. */
export function scan(dir) {
  const report = {};
  const files = globSync('**/*.js', { cwd: dir }).filter((f) => !f.startsWith('client/'));
  for (const file of files) {
    const hits = externalImports(readFileSync(join(dir, file), 'utf8'));
    if (hits.length) report[file] = hits;
  }
  return { files: files.length, report };
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? 'build';
  const { files, report } = scan(dir);
  const entries = Object.entries(report).sort();
  for (const [file, hits] of entries) console.error(`${file}: ${hits.join(', ')}`);
  if (files === 0) {
    console.error(`no server files under ${dir}`);
    process.exit(1);
  }
  if (entries.length) {
    console.error(
      `\n${entries.length} of ${files} server files import a package build/ does not carry.` +
        ' Bundle it through ssr.noExternal in vite.config.ts.',
    );
    process.exit(1);
  }
  console.log(`${files} server files, every import is inside ${dir}`);
}
