// narvai guard (Claude Code hook: UserPromptSubmit, PostToolUse).
// Subagents only: live context from the subagent transcript's last `usage`, one line per band crossed.
// The main agent has no limit; Claude Code manages its context. Plus a one-time reminder to invoke narvai.
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const event = input.hook_event_name;
const agentId = input.agent_id;
if (!agentId && event !== 'UserPromptSubmit') process.exit(0);

const home = homedir();
const cfgPath = join(home, '.narvai', 'config.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const sessionId = input.session_id ?? 'unknown';
const stateDir = join(home, '.narvai', 'state');
mkdirSync(stateDir, { recursive: true });
const statePath = join(stateDir, `${sessionId}${agentId ? '-' + agentId : ''}.json`);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const notes = [];

function tail(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally { closeSync(fd); }
}

if (agentId && input.transcript_path) {
  const transcript = join(dirname(input.transcript_path), sessionId, 'subagents', `agent-${agentId}.jsonl`);
  if (existsSync(transcript)) {
    const m = [...tail(transcript, 512 * 1024).matchAll(/"usage":\{"input_tokens":(\d+),"cache_creation_input_tokens":(\d+),"cache_read_input_tokens":(\d+)/g)].at(-1);
    if (m) {
      const tokens = Number(m[1]) + Number(m[2]) + Number(m[3]);
      const warn = cfg.subagentWarn ?? 200_000;
      const ret = cfg.subagentReturn ?? 300_000;
      const band = tokens >= ret ? 2 : tokens >= warn ? 1 : 0;
      const k = Math.round(tokens / 1000);
      if (band > (state.band ?? 0)) {
        notes.push(band === 2
          ? `narvai: this subagent is at ~${k}K tokens (limit ${Math.round(ret / 1000)}K). Stop now and return your findings, with what is still open.`
          : `narvai: this subagent is at ~${k}K tokens (warn ${Math.round(warn / 1000)}K). Finish from the evidence you have: no broad search, no large reads.`);
      }
      state.band = band;
    }
  }
}

function invokedSince(t, offset) {
  if (!t || !existsSync(t)) return { found: false, offset };
  const size = statSync(t).size;
  if (size <= offset) return { found: false, offset: size };
  const fd = openSync(t, 'r');
  try {
    const len = Math.min(size - offset, 32 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return { found: /"skill":"narvai-orchestrator"/.test(buf.toString('utf8')), offset: size };
  } finally { closeSync(fd); }
}

if (event === 'UserPromptSubmit' && !agentId && !state.invoked && state.known !== false) {
  const storeRoot = process.env.AI_HARNESS_MEMORY ?? cfg.storeRoot;
  const mapPath = storeRoot && join(storeRoot, 'map.json');
  if (state.known === undefined) {
    const cwd = input.cwd && resolve(input.cwd).toLowerCase();
    state.known = Boolean(cwd && mapPath && existsSync(mapPath) && Object.keys(JSON.parse(readFileSync(mapPath, 'utf8'))).some((repo) => {
      const r = resolve(repo).toLowerCase();
      return cwd === r || cwd.startsWith(r + '\\') || cwd.startsWith(r + '/');
    }));
  }
  if (state.known) {
    const seen = invokedSince(input.transcript_path, state.offset ?? 0);
    state.offset = seen.offset;
    if (seen.found) state.invoked = true;
    else notes.push('narvai: this repo is managed by narvai. Before any search, file read or plan for a request to build, change, fix, review, plan or ship code here, call the Skill tool with narvai-orchestrator. Skip it only for small talk or a question about the harness itself.');
  }
}

writeFileSync(statePath, JSON.stringify(state));
if (notes.length) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: notes.join('\n') } }));
}
