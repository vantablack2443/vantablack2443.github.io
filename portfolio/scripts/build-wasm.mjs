// Builds water-rs (Rust) to WebAssembly and copies the module to src/river/wasm/water.wasm.
// Run by `npm run build:wasm`, and by predev / prebuild / pretest so the module is always fresh.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'water-rs');
// rustup installs cargo in ~/.cargo/bin, which a non-login shell may not have on PATH
const env = { ...process.env, PATH: `${join(homedir(), '.cargo', 'bin')}${delimiter}${process.env.PATH ?? ''}` };

try {
  execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: crate, env, stdio: 'inherit' });
} catch (err) {
  console.error('\nbuild:wasm needs Rust with the wasm target: rustup target add wasm32-unknown-unknown');
  process.exit(err.status ?? 1);
}
const out = join(root, 'src', 'river', 'wasm');
mkdirSync(out, { recursive: true });
copyFileSync(join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'water_rs.wasm'), join(out, 'water.wasm'));
console.log('water.wasm ready in src/river/wasm/');
