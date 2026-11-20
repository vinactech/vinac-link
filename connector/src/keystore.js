// Protects keys with the operating system:
//   Windows: DPAPI (CurrentUser) — only this Windows account can unwrap it.
//   macOS:   the login Keychain.
//   Linux:   the Secret Service keyring (GNOME Keyring, KWallet...) via `secret-tool`.
// There is no silent fallback. A plain user-only file ("file") is used only
// when the key store is set to "file" on purpose (tests, development).
// Note: these stores release keys to any program running as the same user;
// they protect against other accounts and copied files, not same-user code.
// Secrets go to helper programs through stdin, never on the command line.
import { execFileSync } from 'node:child_process';
import { env } from './env.js';

const KINDS = new Set(['dpapi', 'keychain', 'secret-service', 'file']);
const envKeystore = () => env('KEYSTORE');

// `secret-tool` (libsecret). VINAC_SECRET_TOOL may name a Node script that acts like it (tests only).
const secretTool = (args, opts) => (env('SECRET_TOOL')
  ? execFileSync(process.execPath, [env('SECRET_TOOL'), ...args], opts)
  : execFileSync('secret-tool', args, opts));
function hasSecretTool() {
  if (env('SECRET_TOOL')) return true;
  try { execFileSync('secret-tool', ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return e.code !== 'ENOENT'; }
}

export function detectKeystore() {
  const forced = envKeystore();
  if (forced !== undefined && forced !== '') {
    if (!KINDS.has(forced)) throw new Error(`VINAC_KEYSTORE must be dpapi, keychain, secret-service or file (got "${forced}")`);
    return forced;
  }
  if (process.platform === 'win32') return 'dpapi';
  if (process.platform === 'darwin') return 'keychain';
  if (process.platform === 'linux') {
    if (hasSecretTool()) return 'secret-service';
    throw new Error('No key store found. Install libsecret-tools (Debian/Ubuntu: sudo apt install libsecret-tools) with a running keyring (GNOME Keyring or KWallet), or set VINAC_KEYSTORE=file to accept a plain user-only file.');
  }
  throw new Error('No OS key store on this platform. Set VINAC_KEYSTORE=file to accept a plain user-only file.');
}

/** True when keys are only in a plain file (development/test mode). */
export const isPlainFile = kind => kind === 'file';

const PS_PROTECT = "Add-Type -AssemblyName System.Security; $d=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($d,$null,'CurrentUser'))";
const PS_UNPROTECT = "Add-Type -AssemblyName System.Security; $d=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($d,$null,'CurrentUser'))";

function powershell(script, input) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

const KEYCHAIN_ACCOUNT = 'agentlink';
const LABEL_OK = /^[A-Za-z0-9_.-]{1,120}$/;

/** Returns { kind, stored }; `stored` goes into the JSON file (null for the Keychain). Throws on failure. */
export function protect(kind, label, bytes) {
  if (!KINDS.has(kind)) throw new Error(`Unknown key store "${kind}"`);
  if (!LABEL_OK.test(label)) throw new Error('Bad key label');
  const b64 = Buffer.from(bytes).toString('base64');
  if (kind === 'dpapi') return { kind, stored: powershell(PS_PROTECT, b64) };
  if (kind === 'keychain') {
    // `security -i` reads the command from stdin, keeping the key out of argv.
    execFileSync('security', ['-i'], {
      input: `add-generic-password -U -a ${KEYCHAIN_ACCOUNT} -s "${label}" -w "${b64}"\n`, stdio: ['pipe', 'ignore', 'pipe'],
    });
    return { kind, stored: null };
  }
  if (kind === 'secret-service') {
    // `secret-tool store` reads the secret from stdin.
    secretTool(['store', `--label=VINAC Link ${label}`, ...SS_ATTRS(label)], { input: b64, stdio: ['pipe', 'ignore', 'pipe'] });
    return { kind, stored: null };
  }
  return { kind: 'file', stored: b64 };
}
const SS_ATTRS = label => ['application', 'vinac-link', 'key', label];

export function unprotect(kind, label, stored) {
  if (!KINDS.has(kind)) throw new Error(`Unknown key store "${kind}"`);
  if (kind === 'dpapi') return Buffer.from(powershell(PS_UNPROTECT, stored), 'base64');
  if (kind === 'keychain') {
    if (!LABEL_OK.test(label)) throw new Error('Bad key label');
    const out = execFileSync('security', ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', label, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return Buffer.from(out.trim(), 'base64');
  }
  if (kind === 'secret-service') {
    if (!LABEL_OK.test(label)) throw new Error('Bad key label');
    const out = String(secretTool(['lookup', ...SS_ATTRS(label)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
    if (!out) throw new Error(`Key "${label}" is missing from the keyring`);
    return Buffer.from(out, 'base64');
  }
  return Buffer.from(stored, 'base64');
}

export function forget(kind, label) {
  if (!LABEL_OK.test(label)) return;
  if (kind === 'keychain') { try { execFileSync('security', ['delete-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', label], { stdio: 'ignore' }); } catch { /* already gone */ } }
  if (kind === 'secret-service') { try { secretTool(['clear', ...SS_ATTRS(label)], { stdio: 'ignore' }); } catch { /* already gone */ } }
}
