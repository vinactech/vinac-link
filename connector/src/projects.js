// Projects (0.14 step 3): keys grouped per project and environment on this device.
//  - projects.json: [{ id, name, folders: [absolute paths on THIS device], prodAsks }]
//  - a stored secret may carry `project` (id) and `env` ('dev' | 'prod'); without one it's in "No project"
//  - the folder an agent or program works in picks the project; the same NAME can exist in several
//    projects without clashing
//  - vinac.keys.json in a project's folder lists the key NAMES it needs per environment (never values)
// Only the page creates or changes projects and moves keys between them; agents read names only.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeAtomic } from './store.js';
import { insideFolder } from './grants.js';

export const ENVS = ['dev', 'prod'];
const MAX_PROJECTS = 50;
const NAME = /^[\p{L}\p{N} ._'()-]{1,40}$/u;
const KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const err = (status, message) => Object.assign(new Error(message), { status });

export class Projects {
  constructor(home) { this.file = path.join(home, 'projects.json'); }
  list() {
    try { const p = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(p.projects) ? p.projects : []; }
    catch { return []; }
  }
  save(list) { writeAtomic(this.file, JSON.stringify({ v: 1, projects: list }, null, 1)); }
  get(ref) {
    const q = String(ref ?? '').trim();
    return this.list().find(p => p.id === q) || this.list().find(p => p.name.toLowerCase() === q.toLowerCase()) || null;
  }
  /** The project whose folder holds `cwd` (the deepest match wins). */
  forFolder(cwd) {
    if (!cwd || !path.isAbsolute(String(cwd))) return null;
    let best = null, depth = -1;
    for (const p of this.list()) for (const f of p.folders || []) {
      if (insideFolder(f, cwd) && f.length > depth) { best = p; depth = f.length; }
    }
    return best;
  }
  /** The page: create or change one project. */
  upsert({ id, name, folders, prodAsks }) {
    const list = this.list();
    const n = String(name ?? '').trim();
    if (!NAME.test(n)) throw err(400, 'Give the project a short name (up to 40 characters).');
    const dirs = (Array.isArray(folders) ? folders : []).map(f => String(f).trim()).filter(Boolean).slice(0, 5);
    for (const f of dirs) if (!path.isAbsolute(f)) throw err(400, `Use the full path of the project folder (${f}).`);
    let p = id ? list.find(x => x.id === id) : null;
    if (id && !p) throw err(404, 'No such project.');
    if (list.some(x => x !== p && x.name.toLowerCase() === n.toLowerCase())) throw err(409, 'A project with that name exists already.');
    if (!p) {
      if (list.length >= MAX_PROJECTS) throw err(409, `At most ${MAX_PROJECTS} projects.`);
      p = { id: randomBytes(6).toString('base64url'), createdAt: new Date().toISOString() };
      list.push(p);
    }
    Object.assign(p, { name: n, folders: dirs.map(f => path.resolve(f)), prodAsks: prodAsks !== false });
    this.save(list);
    return p;
  }
  remove(id) {
    const list = this.list();
    if (!list.some(p => p.id === id)) throw err(404, 'No such project.');
    this.save(list.filter(p => p.id !== id));
  }
}

/** Reads vinac.keys.json from the project folder that holds `cwd` (walking up), or null. */
export function readManifest(cwd, stopAt = null) {
  if (!cwd || !path.isAbsolute(String(cwd))) return null;
  let dir = path.resolve(String(cwd));
  for (let i = 0; i < 20; i++) {
    const f = path.join(dir, 'vinac.keys.json');
    if (fs.existsSync(f)) {
      try {
        const m = JSON.parse(fs.readFileSync(f, 'utf8'));
        const out = { file: f };
        for (const env of ENVS) out[env] = (Array.isArray(m?.[env]) ? m[env] : []).map(String).filter(k => KEY.test(k)).slice(0, 100);
        return out;
      } catch { return { file: f, error: 'vinac.keys.json is not valid JSON: {"dev": ["NAME", ...], "prod": [...]}' }; }
    }
    if (stopAt && path.resolve(dir) === path.resolve(stopAt)) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * Picks the stored secret for `name` in this context: the project's own key for that environment
 * first, then the project's key without an environment, then a key in "No project". Never a key
 * that belongs to ANOTHER project.
 */
export function pickSecret(items, name, { project = null, env = 'dev' } = {}) {
  const usable = items.filter(x => x.name === name && !x.pending && !x.offered);
  if (project) {
    const own = usable.filter(x => x.project === project.id);
    return own.filter(x => (x.env || 'dev') === env).at(-1) || own.filter(x => !x.env).at(-1) || usable.filter(x => !x.project).at(-1) || null;
  }
  return usable.filter(x => !x.project).at(-1) || null;
}
