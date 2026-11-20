// Git without a server: `vinac git send` packs a branch into a git bundle and
// sends it as a file; `vinac git fetch <file-id>` checks a received bundle and
// fetches its branches into remote-tracking branches named
// vinac/<device>/<branch>. Nothing is checked out or merged: the person (or
// their agent) reviews with `git log` / `git diff` and merges if they want.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const git = (cwd, args, opts = {}) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('git is not installed (or not on PATH).');
    throw new Error(String(e.stderr || e.message).trim().split('\n').slice(-3).join(' '));
  }
};

const tmpFile = ext => path.join(os.tmpdir(), `vinac-${randomBytes(6).toString('hex')}${ext}`);

/** A safe piece of a remote name: lowercase letters, digits and dashes. */
export const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'device';

/**
 * Packs `branch` (default: the current one) of the repository at `repo`.
 * With `since` (a commit or ref the other side already has), only newer commits.
 * Returns { name, bytes, text } ready for sending.
 */
export function makeBundle({ repo = process.cwd(), branch, since, all = false } = {}) {
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  const head = branch || git(top, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!all && (head === 'HEAD' || !head)) throw new Error('Not on a branch (detached HEAD). Name one with --branch.');
  if (!all) git(top, ['rev-parse', '--verify', `refs/heads/${head}`]);
  const file = tmpFile('.bundle');
  try {
    const range = all ? ['--all'] : since ? [`${since}..${head}`] : [head];
    git(top, ['bundle', 'create', file, ...range]);
    const bytes = fs.readFileSync(file);
    const repoName = slug(path.basename(top));
    const tip = all ? '' : git(top, ['log', '-1', '--format=%h %s', head]).slice(0, 160);
    const count = all ? '' : git(top, ['rev-list', '--count', since ? `${since}..${head}` : head]);
    return {
      name: `${repoName}-${all ? 'all' : slug(head)}.bundle`,
      bytes,
      text: all ? `Git update: all branches of ${path.basename(top)}.` : `Git update: ${path.basename(top)}, branch ${head} (${count} commit${count === '1' ? '' : 's'}${since ? ` since ${since}` : ''}), latest ${tip}`,
      branch: all ? null : head,
    };
  } finally { fs.rmSync(file, { force: true }); }
}

/**
 * Checks a bundle against the repository at `repo` and fetches its branches as
 * refs/remotes/vinac/<device>/<branch>. Returns the refs it updated.
 */
export function fetchBundle({ repo = process.cwd(), bytes, device }) {
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  const file = tmpFile('.bundle');
  fs.writeFileSync(file, bytes);
  try {
    try { git(top, ['bundle', 'verify', file]); }
    catch (e) { throw new Error(`This bundle does not fit this repository: ${e.message}`); }
    const heads = git(top, ['bundle', 'list-heads', file]).split('\n').map(l => l.trim().split(/\s+/)).filter(([, ref]) => ref?.startsWith('refs/heads/'));
    if (!heads.length) throw new Error('The bundle has no branches.');
    const prefix = `refs/remotes/vinac/${slug(device)}`;
    git(top, ['fetch', '--no-tags', '--no-write-fetch-head', file, `+refs/heads/*:${prefix}/*`]);
    return heads.map(([sha, ref]) => ({ branch: ref.slice('refs/heads/'.length), ref: `${prefix.slice('refs/remotes/'.length)}/${ref.slice('refs/heads/'.length)}`, commit: sha.slice(0, 12) }));
  } finally { fs.rmSync(file, { force: true }); }
}
