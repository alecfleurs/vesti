// Release check: fails if public/app.js uses a name that is not defined (e.g. a helper removed by mistake).
// Usage: node scripts/check-names.mjs  (needs the TypeScript package; uses the global install if present)
import { execSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = execSync('npm root -g').toString().trim();
const ts = (await import(pathToFileURL(path.join(root, 'typescript/lib/typescript.js')).href)).default;
const file = path.resolve('public/app.js');
const prog = ts.createProgram([file], { allowJs: true, checkJs: true, noEmit: true, target: 99, lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] });
const bad = ts.getPreEmitDiagnostics(prog).filter((d) => d.code === 2304 || d.code === 2552);
for (const d of bad) console.log(`app.js:${d.file.getLineAndCharacterOfPosition(d.start).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
console.log(bad.length ? `${bad.length} undefined name(s)` : 'no undefined names');
process.exit(bad.length ? 1 : 0);
