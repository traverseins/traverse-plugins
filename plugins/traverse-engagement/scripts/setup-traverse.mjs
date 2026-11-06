#!/usr/bin/env node
// Save Traverse credentials where Claude can find them.
//
// The traverse-engagements MCP server reads TRAVERSE_API_KEY (and optionally
// TRAVERSE_BASE_URL) when it starts, through ${...} substitution in .mcp.json.
// Anyone who opens the Claude desktop app from its icon never sees a shell, so
// those values have to live in the `env` block of the user-level settings file:
//
//   macOS / Linux   ~/.claude/settings.json
//   Windows         %USERPROFILE%\.claude\settings.json
//
// A project-level .claude/settings.json did not reach the substitution in
// testing, so this script does not touch it.
//
// It edits that block and nothing else: it merges instead of overwriting, saves
// a timestamped backup first, and writes atomically. Node built-ins only, so it
// behaves the same on macOS, Linux and Windows.
//
// Usage:
//   node setup-traverse.mjs                              ask for everything
//   node setup-traverse.mjs --non-interactive --key-file <file> [options]
//   <prints the key> | node setup-traverse.mjs --non-interactive [options]
//   node setup-traverse.mjs --help
//
// The key is never accepted as a plain argument (--key <value>): it would end up
// in shell history and in process listings.
//
// Exit codes:
//   0  done (also "nothing to change", --dry-run and --help)
//   1  something unexpected went wrong
//   2  an option or value was not accepted (nothing was changed)
//   3  the settings file can't be used as it is (nothing was changed)
//   4  the settings file could not be written (nothing was changed)
//   5  cancelled before anything was written

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";

// The two service addresses. PRODUCTION_URL must match the default in
// ../.mcp.json (a test checks), because the plugin falls back to it whenever
// TRAVERSE_BASE_URL is absent. TRAVERSE_BASE_URL is the whole endpoint, path
// included: the plugin appends nothing to it.
export const PRODUCTION_URL = "https://api.traverse-sys.com/mcp_engagements";
export const STAGING_URL = "https://mcp-engagements.staging.trytraverse.com/mcp";

// The only variables this script reads or writes. Everything else in `env`, and
// everything outside `env`, is left exactly as it was.
export const MANAGED_VARS = [
  "TRAVERSE_API_KEY",
  "TRAVERSE_BASE_URL",
  "TRAVERSE_COVERAGE_BENCHMARK",
  "SF_ORG_ALIAS",
  "SF_ACCOUNT_ID_FIELD",
];

export const EXIT = { OK: 0, UNEXPECTED: 1, USAGE: 2, SETTINGS: 3, WRITE: 4, CANCELLED: 5 };

const KEEP_BACKUPS = 3;
// The oldest patched release on each supported Node line, as of the Node.js
// security release of 2026-10-21 (CVE-2026-111497 and others). Lines not listed
// below the newest one are end of life and get no fixes. Update this table with
// each Node security release; keep it in step with server/src/node-version.ts.
export const PATCHED_NODE = { 22: "22.23.4", 24: "24.22.1", 26: "26.12.1" };
const MAX_KEY_LENGTH = 4096;
const MAX_KEY_SOURCE_BYTES = 64 * 1024;
const BACKUP_NAME = /^settings\.json\.bak-(\d{14})(?:-(\d+))?$/;

const HELP = `Traverse credential setup

Saves your Traverse API key, and a few optional settings, where Claude can find
them. They go in the "env" part of your Claude settings file:

  macOS / Linux   ~/.claude/settings.json
  Windows         %USERPROFILE%\\.claude\\settings.json

Your other settings are left exactly as they are, and a backup of the file is
saved before anything is changed.

Usage
  node setup-traverse.mjs
      Asks for your API key (what you type is hidden) and the optional
      settings, shows a summary, and saves it once you confirm.

  node setup-traverse.mjs --non-interactive --key-file <file> [options]
  <prints the key> | node setup-traverse.mjs --non-interactive [options]
      Never asks anything. For IT / MDM rollouts. The key comes from a file or
      from standard input. If neither is given, the key already saved in the
      settings file is kept.

Options
  --key-file <file>              Read the API key from this file.
  --staging                      Use the Traverse staging service.
  --production                   Use the production service. Removes any saved
                                 service address, because production is the
                                 default.
  --base-url <url>               Use another service. Give the full endpoint
                                 address, path included, for example
                                 ${STAGING_URL}
  --benchmark <file>             Your agency's coverage benchmark document.
  --sf-org-alias <alias>         Salesforce org alias.
  --sf-account-id-field <field>  Salesforce field that holds the AMS account id.
  --remove                       Delete every setting this script manages.
  --dry-run                      Show what would be saved (key masked) and write
                                 nothing.
  --non-interactive              Never ask anything (see above).
  -h, --help                     Show this help.

The key can't be given as --key <value>: it would end up in your shell history
and be visible to other programs on the computer.

Exit codes
  0  done (also when there was nothing to change)
  1  something unexpected went wrong
  2  an option or value was not accepted
  3  the settings file can't be used as it is
  4  the settings file could not be written
  5  cancelled before anything was written
In every failure case the settings file is left as it was.
`;

// --- Errors -------------------------------------------------------------------

// An error whose message is already written for the person at the keyboard.
class SetupError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

// The person stopped (Ctrl+C, end of input, or "no" at the confirmation).
export class Cancelled extends Error {}

const usage = (message) => new SetupError(message, EXIT.USAGE);

// --- Small helpers --------------------------------------------------------------

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, name) => Object.prototype.hasOwnProperty.call(object, name);

// What may be shown of a key: a few characters from each end, never more than a
// quarter of it, and nothing at all for a key too short to hide much.
export function maskKey(key) {
  const edge = Math.min(4, Math.floor(key.length / 8));
  if (edge === 0) return "(hidden)";
  return `${key.slice(0, edge)}...${key.slice(key.length - edge)}`;
}

// UTC, so backup names sort in the order they were made even across a daylight
// saving change.
function timestamp(now) {
  return now.toISOString().replace(/\D/g, "").slice(0, 14);
}

// Everything printed goes through this, so a mistake elsewhere can't put a key on
// screen or in an IT log. (Too-short secrets are skipped: replacing every "a"
// would just garble the output.)
function redact(text, secrets) {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join("[hidden]");
  return result;
}

function rememberSecret(secrets, value) {
  if (typeof value === "string" && value.length >= 6) secrets.add(value);
}

// Paths typed or dragged into a prompt: strip the quotes Windows adds, undo the
// backslash escapes macOS/Linux terminals add, and expand a leading ~.
function cleanPathInput(raw, home, platform) {
  let value = String(raw).trim();
  const quote = value[0];
  if (value.length >= 2 && (quote === '"' || quote === "'") && value[value.length - 1] === quote) {
    value = value.slice(1, -1);
  }
  if (platform !== "win32") value = value.replace(/\\(.)/g, "$1");
  if (value === "~") return home;
  if (value.startsWith("~/") || (platform === "win32" && value.startsWith("~\\"))) {
    return path.join(home, value.slice(2));
  }
  return value;
}

// --- Command line ---------------------------------------------------------------

const FLAGS = {
  "--non-interactive": { key: "nonInteractive" },
  "--staging": { key: "staging" },
  "--production": { key: "production" },
  "--remove": { key: "remove" },
  "--dry-run": { key: "dryRun" },
  "--help": { key: "help" },
  "-h": { key: "help" },
  "--key-file": { key: "keyFile", value: true },
  "--base-url": { key: "baseUrl", value: true },
  "--benchmark": { key: "benchmark", value: true },
  "--sf-org-alias": { key: "sfOrgAlias", value: true },
  "--sf-account-id-field": { key: "sfAccountIdField", value: true },
};

// Ways someone might try to put the key on the command line.
const KEY_FLAGS = new Set(["--key", "--api-key", "--traverse-api-key", "--token"]);

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      // Not echoed back: someone who typed the key here would see it printed again.
      throw usage("There is extra text on the command line that I don't understand. Run with --help to see the options.");
    }
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (KEY_FLAGS.has(name)) {
      throw usage(
        "For safety the API key can't be typed on the command line: it would be kept in your shell history and be visible to other programs.\n" +
          "Run this without it and paste the key when asked, or use --key-file <file>, or pipe the key in with --non-interactive.",
      );
    }
    const spec = FLAGS[name];
    if (!spec) throw usage(`I don't recognise the option ${name}. Run with --help to see the options.`);
    if (spec.value) {
      let value;
      if (equals !== -1) {
        value = arg.slice(equals + 1);
      } else {
        value = argv[i + 1];
        i += 1;
        if (value === undefined || value.startsWith("--")) throw usage(`${name} needs a value after it. Run with --help for an example.`);
      }
      opts[spec.key] = value;
    } else {
      if (equals !== -1) throw usage(`${name} doesn't take a value.`);
      opts[spec.key] = true;
    }
  }
  return opts;
}

function checkOptions(opts) {
  const serviceChoices = [opts.staging, opts.production, opts.baseUrl !== undefined].filter(Boolean).length;
  if (serviceChoices > 1) throw usage("Choose only one of --staging, --production and --base-url.");
  if (opts.remove) {
    const setters = ["keyFile", "staging", "production", "baseUrl", "benchmark", "sfOrgAlias", "sfAccountIdField"];
    if (setters.some((name) => opts[name] !== undefined && opts[name] !== false)) {
      throw usage("--remove deletes settings, so it can't be combined with options that save one. Run it on its own.");
    }
  }
}

// --- Validation -----------------------------------------------------------------

// Only trims and rejects the empty value. The format of a key is not guessed at,
// but a key is sent as an HTTP header, so line breaks and other control
// characters can never be part of one.
export function checkKey(raw) {
  const key = String(raw).trim();
  if (key === "") throw usage("The API key is empty. Copy it from the Traverse console and try again.");
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    throw usage("The API key contains line breaks or other characters that can't be part of a key. Copy just the key itself.");
  }
  if (key.length > MAX_KEY_LENGTH) throw usage("That is far too long to be an API key. Copy just the key itself.");
  return key;
}

// TRAVERSE_BASE_URL is the full endpoint, path included (the plugin appends
// nothing), so a bare origin is the mistake to catch: it gets a 404.
export function checkEndpointUrl(raw) {
  const value = String(raw).trim();
  if (value === "") throw usage("The service address is empty.");
  if (/\s/.test(value)) throw usage("The service address can't contain spaces.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw usage("That isn't a web address. It should look like https://example.com/mcp");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw usage("The service address must start with https:// (or http:// for a service running on this computer).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw usage('The service address shouldn\'t contain a user name, a password, "?" or "#".');
  }
  if (url.pathname === "/" || url.pathname === "") {
    throw usage(
      `That address stops at the host name. The plugin uses the address exactly as written (since plugin version 1.13.0 it no longer adds "/mcp" itself), so it needs the full endpoint, path included, for example ${STAGING_URL}\n` +
        "To use the test service, run with --staging instead.",
    );
  }
  if (value.endsWith("/")) {
    throw usage(`Remove the "/" at the end of the address (${value.slice(0, -1)}). The plugin uses the address exactly as written.`);
  }
  return value;
}

function checkFile(raw, what, ctx) {
  const given = String(raw).trim();
  if (given === "") throw usage(`${what} is empty.`);
  const full = path.resolve(ctx.cwd, given);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    throw usage(`I couldn't find a file at ${full}. Check the spelling, or drag the file into this window to paste its location.`);
  }
  if (!stat.isFile()) throw usage(`${full} is a folder, not a file.`);
  return full;
}

function checkText(raw, what) {
  const value = String(raw).trim();
  if (value === "") throw usage(`${what} is empty.`);
  if (/[\u0000-\u001f\u007f]/.test(value) || value.length > 256) throw usage(`${what} doesn't look right. Check it and try again.`);
  return value;
}

function readKeyFile(file, cwd) {
  const full = path.resolve(cwd, file);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    throw usage(`I couldn't find the key file ${full}.`);
  }
  if (!stat.isFile()) throw usage(`${full} is not a file.`);
  if (stat.size > MAX_KEY_SOURCE_BYTES) throw usage(`${full} is too large to be a key file. It should contain only the key.`);
  let text;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch {
    throw usage(`I couldn't read the key file ${full}.`);
  }
  if (text.trim() === "") throw usage(`The key file ${full} is empty.`);
  return checkKey(text);
}

// Standard input as a fallback source for the key in --non-interactive mode. The
// notice is for the case where nothing is being piped in and the input never
// ends, which would otherwise look like a hang.
async function readStdin(stdin, ui) {
  const waiting = setTimeout(() => {
    ui.err("Waiting for the API key on standard input. If you are not piping one in, press Ctrl+D (Ctrl+Z, then Enter, on Windows) or use --key-file.\n");
  }, 2000);
  waiting.unref();
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of stdin) {
      size += chunk.length;
      if (size > MAX_KEY_SOURCE_BYTES) throw usage("What was piped in is too large to be an API key.");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (error instanceof SetupError) throw error;
    return "";
  } finally {
    clearTimeout(waiting);
  }
}

// --- The settings file ------------------------------------------------------------

function describeJsonProblem(file, text, error) {
  // Only the position is reported. V8's own message can quote the text around the
  // mistake, and that text may be an API key.
  const match = /position (\d+)/.exec(String((error && error.message) || ""));
  let where = "";
  if (match) {
    const before = text.slice(0, Number(match[1]));
    where = `It stops making sense near line ${before.split("\n").length}, column ${Number(match[1]) - before.lastIndexOf("\n")}.\n`;
  }
  return (
    `Your Claude settings file has a formatting problem, so I haven't touched it:\n  ${file}\n` +
    `${where}Fix the file (or ask your IT team or Traverse support for help), then run this again.`
  );
}

function readSettings(settingsPath) {
  let bytes;
  try {
    bytes = fs.readFileSync(settingsPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { exists: false, bytes: null, settings: {}, indent: "  ", eol: "\n" };
    }
    throw new SetupError(
      `I couldn't read your Claude settings file${error && error.code ? ` (${error.code})` : ""}:\n  ${settingsPath}\nCheck that it is a normal file you have permission to open, then run this again.`,
      EXIT.SETTINGS,
    );
  }
  let text = bytes.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Notepad adds a byte-order mark
  let settings = {};
  if (text.trim() !== "") {
    try {
      settings = JSON.parse(text);
    } catch (error) {
      throw new SetupError(describeJsonProblem(settingsPath, text, error), EXIT.SETTINGS);
    }
  }
  if (!isPlainObject(settings)) {
    throw new SetupError(`Your Claude settings file doesn't hold a settings object, so I haven't touched it:\n  ${settingsPath}`, EXIT.SETTINGS);
  }
  if (hasOwn(settings, "env") && !isPlainObject(settings.env)) {
    throw new SetupError(`The "env" part of your Claude settings file isn't in the expected form, so I haven't touched it:\n  ${settingsPath}`, EXIT.SETTINGS);
  }
  const firstIndent = /^([ \t]+)\S/m.exec(text);
  return {
    exists: true,
    bytes,
    settings,
    indent: firstIndent ? firstIndent[1] : "  ",
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
}

// Applies the wanted changes to a copy of the settings. Key order is preserved,
// and nothing is touched when nothing differs, so a repeat run changes no bytes.
function planChanges(settings, wanted) {
  const before = isPlainObject(settings.env) ? settings.env : {};
  const env = { ...before };
  const changes = [];
  for (const name of MANAGED_VARS) {
    const had = hasOwn(before, name);
    if (hasOwn(wanted.set, name)) {
      const value = wanted.set[name];
      if (had && before[name] === value) {
        changes.push({ name, kind: "unchanged", value });
      } else {
        env[name] = value;
        changes.push({ name, kind: had ? "changed" : "added", value });
      }
    } else if (wanted.unset.includes(name) && had) {
      delete env[name];
      changes.push({ name, kind: "removed" });
    } else {
      changes.push({ name, kind: had ? "kept" : "absent", value: before[name] });
    }
  }
  const changed = changes.some((change) => ["added", "changed", "removed"].includes(change.kind));
  const next = { ...settings };
  if (changed) {
    if (Object.keys(env).length === 0) delete next.env;
    else next.env = env;
  }
  return { next, changes, changed };
}

function serialize(settings, existing) {
  const text = `${JSON.stringify(settings, null, existing.indent)}\n`;
  return existing.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function compareBackups(a, b) {
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return Number(a[2] || 0) - Number(b[2] || 0);
}

function listBackups(dir) {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => BACKUP_NAME.exec(name))
      .filter(Boolean)
      .sort(compareBackups)
      .map((match) => match[0]);
  } catch {
    return [];
  }
}

// Backups hold the key, so only the newest few are kept. Best effort: failing to
// delete an old one is not worth failing a save that already succeeded.
function pruneBackups(dir) {
  const names = listBackups(dir);
  for (const name of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* leave it */
    }
  }
}

function createBackup(dir, bytes, now, platform) {
  const stamp = timestamp(now);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = `settings.json.bak-${stamp}${attempt === 0 ? "" : `-${attempt}`}`;
    const file = path.join(dir, name);
    try {
      // Created owner-only from the start. "wx" refuses to overwrite, so two runs
      // in the same second can't destroy each other's backup.
      fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
      if (platform !== "win32") fs.chmodSync(file, 0o600);
      return name;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("could not find a free backup name");
}

function writeFailure(settingsPath, error) {
  const code = error && error.code ? ` (${error.code})` : "";
  const locked =
    error && ["EPERM", "EBUSY", "EACCES"].includes(error.code)
      ? "\nThe file may be open in another program, or you may not have permission to change it. Close other programs that use it and try again."
      : "";
  return new SetupError(`I couldn't save your settings${code}:\n  ${settingsPath}${locked}`, EXIT.WRITE);
}

// Backup first, then write a temp file next to the target and rename it over the
// original, so Claude can never read a half-written file.
function saveSettings({ settingsPath, existing, text, now, platform }) {
  const dir = path.dirname(settingsPath);
  let backup = null;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (existing.exists) backup = createBackup(dir, existing.bytes, now, platform);
  } catch (error) {
    throw writeFailure(settingsPath, error);
  }
  // A settings file that is a symlink (dotfile managers do this) stays one: the
  // new content goes to the real file. Backups stay beside the link, not inside
  // whatever repository the link points into.
  let target = settingsPath;
  if (existing.exists) {
    try {
      target = fs.realpathSync(settingsPath);
    } catch {
      target = settingsPath;
    }
  }
  const temp = path.join(path.dirname(target), `.settings.json.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    if (platform !== "win32") fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, target);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* it was never created */
    }
    throw writeFailure(settingsPath, error);
  }
  pruneBackups(dir);
  return { backup };
}

// --- What the person sees ----------------------------------------------------------

function show(change) {
  if (change.value === undefined) return "";
  if (typeof change.value !== "string") return "(not text)";
  return change.name === "TRAVERSE_API_KEY" ? maskKey(change.value) : change.value;
}

function changeLine(change) {
  const label = change.name.padEnd(28);
  switch (change.kind) {
    case "added":
      return `  ${label}added      ${show(change)}`;
    case "changed":
      return `  ${label}changed    ${show(change)}`;
    case "removed":
      return `  ${label}removed`;
    case "unchanged":
      return `  ${label}no change  ${show(change)}`;
    case "kept":
      return `  ${label}kept       ${show(change)}`;
    default:
      return `  ${label}not set`;
  }
}

function summaryText(settingsPath, plan) {
  return `\nThis is what will be saved in:\n  ${settingsPath}\n\n${plan.changes.map(changeLine).join("\n")}\n\n`;
}

function dryRunText(settingsPath, plan) {
  const env = plan.next.env || {};
  const shown = {};
  for (const name of MANAGED_VARS) {
    if (hasOwn(env, name)) shown[name] = name === "TRAVERSE_API_KEY" ? maskKey(String(env[name])) : env[name];
  }
  const others = Object.keys(env).filter((name) => !MANAGED_VARS.includes(name)).length;
  return (
    `Dry run: nothing was written.\nAfter this change the "env" part of\n  ${settingsPath}\nwould hold these Traverse settings:\n\n${JSON.stringify({ env: shown }, null, 2)}\n` +
    (others > 0 ? `\n(${others} other ${others === 1 ? "entry" : "entries"} in "env" would stay as they are and are not shown.)\n` : "") +
    (plan.changed ? "" : "\nThat is the same as what is saved now.\n")
  );
}

function finishText({ settingsPath, plan, saved, removing }) {
  const dir = path.dirname(settingsPath);
  const sections = [
    `${removing ? "Done. The Traverse settings were removed from:" : "Done. Your Traverse settings are saved in:"}\n  ${settingsPath}`,
    ["What changed:", ...plan.changes.filter((change) => change.kind !== "absent").map(changeLine)].join("\n"),
  ];
  const notes = [];
  if (saved.backup) {
    notes.push(`A backup of your previous settings is in the same folder: ${saved.backup}`);
    notes.push(`(The ${KEEP_BACKUPS} newest backups are kept, because they contain your key. Older ones are deleted.)`);
  }
  if (removing && listBackups(dir).length > 0) {
    notes.push(`Earlier backups in ${dir} may still contain your old key: delete them if you don't want it kept.`);
  }
  if (notes.length > 0) sections.push(notes.join("\n"));
  const next = [
    "Next:",
    `  1. Fully quit the Claude desktop app (choose Quit, because closing the window isn't enough) and open it again. Claude only reads these settings when it starts${removing ? ", so it keeps using the old ones until then" : ""}.`,
  ];
  if (!removing) next.push('  2. In Cowork, ask Claude: "authenticate to Traverse". That confirms the key works.');
  sections.push(next.join("\n"));
  return `\n${sections.join("\n\n")}\n`;
}

// --- Questions ----------------------------------------------------------------------

// Hidden input, without any dependency: readline in terminal mode does the line
// editing, and its echo goes to a sink that is muted while a secret is typed.
function createTtyPrompter(stdin, stdout) {
  let muted = false;
  const sink = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) stdout.write(chunk, encoding);
      callback();
    },
  });
  sink.columns = stdout.columns;
  const rl = readline.createInterface({ input: stdin, output: sink, terminal: true, historySize: 0 });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  return {
    ask(question, { hidden = false } = {}) {
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new Cancelled());
          return;
        }
        // Ctrl+C and Ctrl+D close the interface; the question never answers.
        const onClose = () => reject(new Cancelled());
        rl.once("close", onClose);
        muted = false;
        rl.question(question, (answer) => {
          rl.removeListener("close", onClose);
          muted = false;
          if (hidden) stdout.write("\n");
          resolve(answer);
        });
        muted = hidden;
      });
    },
    close() {
      if (!closed) rl.close();
    },
  };
}

async function askUntilValid(prompter, ui, question, validate) {
  for (;;) {
    const answer = await prompter.ask(question);
    if (answer.trim() === "") return undefined;
    try {
      return validate(answer);
    } catch (error) {
      if (!(error instanceof SetupError)) throw error;
      ui.out(`${error.message}\n`);
    }
  }
}

async function askKey(prompter, ui, existingKey) {
  const question = existingKey
    ? `Traverse API key. Press Enter to keep your current key (${maskKey(existingKey)}), or paste a new one (typing is hidden): `
    : "Traverse API key. Paste it and press Enter (typing is hidden): ";
  for (;;) {
    const answer = await prompter.ask(question, { hidden: true });
    if (answer.trim() === "") {
      if (existingKey) return null;
      ui.out("An API key is needed to continue. Paste your key, or press Ctrl+C to stop.\n");
      continue;
    }
    try {
      return checkKey(answer);
    } catch (error) {
      if (!(error instanceof SetupError)) throw error;
      ui.out(`${error.message}\n`);
    }
  }
}

function serviceLabel(existingEnv) {
  const current = existingEnv.TRAVERSE_BASE_URL;
  if (typeof current !== "string" || current === "") return "production";
  return current === STAGING_URL ? "staging" : current;
}

// undefined = leave alone, null = remove (production), string = set.
async function askService(prompter, ui, existingEnv) {
  const question = `Which Traverse service should Claude use? Press Enter to leave it as it is (${serviceLabel(existingEnv)}), or type "staging" or "production": `;
  for (;;) {
    const answer = (await prompter.ask(question)).trim();
    if (answer === "") return undefined;
    if (/^prod(uction)?$/i.test(answer)) return null;
    if (/^staging$/i.test(answer)) return STAGING_URL;
    try {
      return checkEndpointUrl(answer);
    } catch (error) {
      if (!(error instanceof SetupError)) throw error;
      ui.out(`${error.message}\n`);
    }
  }
}

// --- The run ---------------------------------------------------------------------------

function makeContext(io) {
  const stdin = io.stdin || process.stdin;
  return {
    stdin,
    stdout: io.stdout || process.stdout,
    stderr: io.stderr || process.stderr,
    isTTY: io.isTTY !== undefined ? io.isTTY : Boolean(stdin.isTTY),
    homeDir: io.homeDir || null,
    cwd: io.cwd || process.cwd(),
    platform: io.platform || process.platform,
    now: io.now || new Date(),
    nodeVersion: io.nodeVersion || process.versions.node,
    prompter: io.prompter || null,
  };
}

function resolveHome(ctx) {
  if (ctx.homeDir) return ctx.homeDir;
  let home = "";
  try {
    home = os.homedir();
  } catch {
    /* reported below */
  }
  if (!home) throw usage("I couldn't work out where your home folder is, so I don't know where your Claude settings file lives.");
  return home;
}

// Patched: at or above the floor of a listed line, or on a line newer than any
// listed. Anything else (an end-of-life line, or an unpatched release) is not.
export function isPatchedNode(version) {
  const parts = String(version).replace(/^v/, "").split(".").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isInteger(n))) return true; // unreadable: don't nag
  const majors = Object.keys(PATCHED_NODE).map(Number);
  if (parts[0] > Math.max(...majors)) return true;
  const floor = PATCHED_NODE[parts[0]];
  if (!floor) return false;
  const want = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (parts[i] !== want[i]) return parts[i] > want[i];
  return true;
}

function warnAboutOldNode(ctx, ui) {
  if (!isPatchedNode(ctx.nodeVersion)) {
    const versions = Object.values(PATCHED_NODE).join(", ");
    ui.err(
      `Warning: this computer has Node.js ${ctx.nodeVersion}, which has known security vulnerabilities. The Traverse plugin's file-upload helper runs on Node.js, so please update to ${versions} or newer on the same line (https://nodejs.org). Your settings can still be saved now.\n\n`,
    );
  }
}

// Works out what to set and unset: from the options first (all validated before a
// single question is asked), then, in interactive mode, from the questions.
async function collectWanted(opts, ctx, ui, state, existingEnv, existingKey, interactive) {
  const prompter = state.prompter;
  let key = opts.keyFile !== undefined ? readKeyFile(opts.keyFile, ctx.cwd) : null;
  let service; // undefined = leave alone, null = remove, string = set
  if (opts.staging) service = STAGING_URL;
  else if (opts.production) service = null;
  else if (opts.baseUrl !== undefined) service = checkEndpointUrl(opts.baseUrl);
  let benchmark = opts.benchmark !== undefined ? checkFile(opts.benchmark, "The coverage benchmark path", ctx) : undefined;
  let sfOrgAlias = opts.sfOrgAlias !== undefined ? checkText(opts.sfOrgAlias, "The Salesforce org alias") : undefined;
  let sfField = opts.sfAccountIdField !== undefined ? checkText(opts.sfAccountIdField, "The Salesforce account-id field") : undefined;

  if (!interactive && key === null && !ctx.isTTY) {
    // The fallback key source. Empty input means no key was supplied.
    const piped = await readStdin(ctx.stdin, ui);
    if (piped.trim() !== "") key = checkKey(piped);
  }
  if (key) rememberSecret(ui.secrets, key);

  if (interactive) {
    ui.out(
      `Traverse setup for Claude\n\nThis saves your Traverse API key where Claude can find it:\n  ${path.join(ctx.homeDir, ".claude", "settings.json")}\nYour other Claude settings are left alone, and a backup is saved first.\nPress Ctrl+C at any time to stop without changing anything.\n\n`,
    );
    if (key === null) {
      key = await askKey(prompter, ui, existingKey);
      if (key) rememberSecret(ui.secrets, key);
    }
    if (service === undefined) service = await askService(prompter, ui, existingEnv);
    const current = (name) => (typeof existingEnv[name] === "string" && existingEnv[name] !== "" ? ` (currently ${existingEnv[name]}, press Enter to keep it)` : "");
    if (benchmark === undefined) {
      benchmark = await askUntilValid(
        prompter,
        ui,
        `Coverage benchmark file, the document your agency's coverage analysis is based on. Optional, press Enter to skip${current("TRAVERSE_COVERAGE_BENCHMARK")}: `,
        (answer) => checkFile(cleanPathInput(answer, ctx.homeDir, ctx.platform), "That path", ctx),
      );
    }
    if (sfOrgAlias === undefined) {
      sfOrgAlias = await askUntilValid(prompter, ui, `Salesforce org alias. Optional, press Enter to skip${current("SF_ORG_ALIAS")}: `, (answer) =>
        checkText(answer, "The Salesforce org alias"),
      );
    }
    if (sfField === undefined) {
      sfField = await askUntilValid(prompter, ui, `Salesforce field that holds the AMS account id. Optional, press Enter to skip${current("SF_ACCOUNT_ID_FIELD")}: `, (answer) =>
        checkText(answer, "The Salesforce field name"),
      );
    }
  }

  const set = {};
  const unset = [];
  if (key) set.TRAVERSE_API_KEY = key;
  if (service === null) {
    unset.push("TRAVERSE_BASE_URL");
  } else if (typeof service === "string") {
    if (service === PRODUCTION_URL) {
      // The default already points here, and a pinned copy would not follow the
      // next time the default moves.
      unset.push("TRAVERSE_BASE_URL");
      ui.out("That is the production address, which the plugin already uses, so no service address is saved.\n");
    } else {
      set.TRAVERSE_BASE_URL = service;
    }
  }
  if (benchmark !== undefined) set.TRAVERSE_COVERAGE_BENCHMARK = benchmark;
  if (sfOrgAlias !== undefined) set.SF_ORG_ALIAS = sfOrgAlias;
  if (sfField !== undefined) set.SF_ACCOUNT_ID_FIELD = sfField;
  return { set, unset };
}

async function execute(opts, ctx, ui, state) {
  ctx.homeDir = resolveHome(ctx);
  const settingsPath = path.join(ctx.homeDir, ".claude", "settings.json");
  const existing = readSettings(settingsPath);
  const existingEnv = isPlainObject(existing.settings.env) ? existing.settings.env : {};
  const existingKey = typeof existingEnv.TRAVERSE_API_KEY === "string" && existingEnv.TRAVERSE_API_KEY.trim() !== "" ? existingEnv.TRAVERSE_API_KEY : null;
  rememberSecret(ui.secrets, existingKey);

  const interactive = !opts.nonInteractive;
  if (interactive) {
    state.prompter = ctx.prompter || (ctx.isTTY ? createTtyPrompter(ctx.stdin, ctx.stdout) : null);
    if (!state.prompter) {
      throw usage(
        "This has to run in a terminal window, so that your key can be typed privately. Open Terminal (macOS) or PowerShell (Windows) and run it there.\n" +
          "For an unattended setup, add --non-interactive. Run with --help for details.",
      );
    }
  }

  const wanted = opts.remove
    ? { set: {}, unset: [...MANAGED_VARS] }
    : await collectWanted(opts, ctx, ui, state, existingEnv, existingKey, interactive);
  const plan = planChanges(existing.settings, wanted);

  // A key is required unless the run only removes things.
  const onlyProduction = opts.production && opts.keyFile === undefined && opts.benchmark === undefined && opts.sfOrgAlias === undefined && opts.sfAccountIdField === undefined;
  const resultingKey = plan.next.env && typeof plan.next.env.TRAVERSE_API_KEY === "string" ? plan.next.env.TRAVERSE_API_KEY : null;
  if (!resultingKey && !opts.remove && !onlyProduction) {
    throw usage(
      "There is no API key to save. Pass it with --key-file <file>, or pipe it in on standard input, together with --non-interactive. Run with --help for examples.",
    );
  }

  if (opts.dryRun) {
    ui.out(dryRunText(settingsPath, plan));
    return EXIT.OK;
  }
  if (!plan.changed) {
    ui.out(opts.remove ? `There is nothing to remove: none of the Traverse settings are saved in\n  ${settingsPath}\n` : `Nothing to change: the settings in\n  ${settingsPath}\nalready match.\n`);
    return EXIT.OK;
  }

  if (interactive) {
    ui.out(summaryText(settingsPath, plan));
    const answer = await state.prompter.ask(
      opts.remove
        ? "Remove these settings? Type y and press Enter to confirm, or just press Enter to cancel: "
        : "Save these settings? Type y and press Enter to save, or just press Enter to cancel: ",
    );
    if (!/^(y|yes)$/i.test(answer.trim())) throw new Cancelled();
  }

  const saved = saveSettings({ settingsPath, existing, text: serialize(plan.next, existing), now: ctx.now, platform: ctx.platform });
  state.wrote = true;
  ui.out(finishText({ settingsPath, plan, saved, removing: Boolean(opts.remove) }));
  return EXIT.OK;
}

// Runs the whole thing and returns the exit code. Everything that touches the
// outside world can be swapped through `io`, which is how the tests drive it
// against a throwaway home folder.
export async function run(argv, io = {}) {
  const ctx = makeContext(io);
  const secrets = new Set();
  const ui = {
    secrets,
    out: (text) => ctx.stdout.write(redact(text, secrets)),
    err: (text) => ctx.stderr.write(redact(text, secrets)),
  };
  const state = { prompter: null, wrote: false };
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      ui.out(HELP);
      return EXIT.OK;
    }
    checkOptions(opts);
    warnAboutOldNode(ctx, ui);
    return await execute(opts, ctx, ui, state);
  } catch (error) {
    if (error instanceof Cancelled) {
      ui.err("\nCancelled. Nothing was changed.\n");
      return EXIT.CANCELLED;
    }
    if (error instanceof SetupError) {
      ui.err(`\n${error.message}\n${state.wrote ? "" : "Nothing was changed.\n"}`);
      return error.exitCode;
    }
    const code = error && error.code ? ` (${error.code})` : "";
    ui.err(`\nSomething unexpected went wrong${code}. ${state.wrote ? "Your settings were saved, but a last step did not finish." : "Nothing was changed."}\n`);
    return EXIT.UNEXPECTED;
  } finally {
    if (state.prompter && state.prompter.close) state.prompter.close();
  }
}

// Start only when run as a script, not when the tests import it. Matching on the
// file name rather than comparing paths avoids symlink and drive-letter-case
// mismatches on Windows.
if (/(^|[\\/])setup-traverse\.mjs$/i.test(process.argv[1] || "")) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("\nSomething unexpected went wrong. Nothing was changed.\n");
      process.exitCode = EXIT.UNEXPECTED;
    },
  );
}
