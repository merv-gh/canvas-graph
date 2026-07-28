// Tool dispatcher with TDD phase guards. Tool families live beside this file.
import { relative, resolve } from 'node:path';
import { appTools } from './tools-app.mjs';
import { authorTools } from './tools-author.mjs';
import { readTools } from './tools-read.mjs';
import { workspaceTools } from './tools-workspace.mjs';

const DENY = /node_modules|\.git\//;

export class Tools {
  constructor({ ws, browser, log }) {
    this.ws = ws;
    this.browser = browser;
    this.log = log;
    this.phase = 'red';
    this.taskTestPath = null;
    Object.assign(this, readTools, authorTools, workspaceTools, appTools);
  }

safePath(p) {
    const abs = resolve(this.ws.dir, p);
    const rel = relative(this.ws.dir, abs);
    if (rel.startsWith('..') || DENY.test(rel)) throw new Error(`path not allowed: ${p}`);
    return { abs, rel };
  }

writeAllowed(rel) {
    if (this.phase === 'red') return rel.startsWith('tests/commands/dx/');
    if (this.phase === 'green') return rel.startsWith('frontend/');
    return false;
  }

async dispatch(name, args) {
    const fn = this[`tool_${name}`];
    if (!fn) return `unknown tool: ${name}`;
    try { return await fn.call(this, args ?? {}); }
    catch (err) { return `error: ${err.message}`; }
  }
}
