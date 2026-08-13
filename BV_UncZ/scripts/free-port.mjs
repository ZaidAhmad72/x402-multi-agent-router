#!/usr/bin/env node
/**
 * Frees a dev port before starting a service, so `npm run dev` (tsx watch)
 * doesn't die with EADDRINUSE every time a previous run was left dangling.
 *
 * `tsx watch` is two processes, not one: a supervisor (`tsx/dist/cli.mjs
 * watch index.ts`) that never itself binds the port, and a child it spawns
 * (`node --import tsx/dist/loader.mjs index.ts`) that does. Killing only the
 * child -- which is all `Get-NetTCPConnection`'s owning-process points at --
 * leaves a *live* supervisor sitting there, and the moment its child dies
 * the supervisor just spawns a fresh one, re-grabbing the port before (or
 * right after) the new `npm run dev` gets to it. That's a still-running old
 * terminal/session, not a dead zombie, and it will keep winning that race
 * forever unless the supervisor itself is killed too. So: walk up from the
 * port-holder to its parent, and if that parent looks like a tsx-watch
 * supervisor, kill the parent (which takes its child down with it via
 * taskkill /T on Windows); otherwise just kill the port-holder directly
 * (covers plain `tsx index.ts` / `node index.ts`, no watch supervisor).
 *
 * Run as each service's `predev`/`prestart` (npm runs those automatically
 * before `dev`/`start`), one argv: the port to free.
 *
 * Safety: only ever kills a process whose own command line resolves to a
 * node.exe running THIS repo's tsx loader/watch-cli -- never an unrelated
 * process that happens to be on the port, even though these dev ports are
 * project-owned by convention.
 */

const port = process.argv[2];
if (!port || Number.isNaN(Number(port))) {
  console.error('free-port: usage: node free-port.mjs <port>');
  process.exit(1);
}

const { execSync } = await import('node:child_process');
const isWindows = process.platform === 'win32';

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function looksLikeThisRepo(cmdLine) {
  return /node(\.exe)?"?\s/i.test(cmdLine) && /tsx[\\/]dist/i.test(cmdLine);
}

function looksLikeWatchSupervisor(cmdLine) {
  return /tsx[\\/]dist[\\/]cli\.mjs/i.test(cmdLine) && /\bwatch\b/i.test(cmdLine);
}

if (isWindows) {
  const conns = safeExec(
    `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`
  )
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const pids = [...new Set(conns)];
  for (const pid of pids) {
    const proc = safeExec(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\" | Select-Object CommandLine,ParentProcessId | ConvertTo-Json"`
    );
    let cmdLine = '';
    let parentPid = '';
    try {
      const parsed = JSON.parse(proc || '{}');
      cmdLine = parsed.CommandLine || '';
      parentPid = parsed.ParentProcessId || '';
    } catch {
      // fall through with empty cmdLine -- treated as "unknown, leave alone" below
    }

    if (!looksLikeThisRepo(cmdLine)) {
      if (cmdLine) {
        console.warn(
          `free-port: port ${port} is held by PID ${pid}, which doesn't look like this repo's dev server -- leaving it alone.`
        );
      }
      continue;
    }

    const parentCmdLine = parentPid
      ? safeExec(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId = ${parentPid}\\").CommandLine"`)
      : '';

    if (parentCmdLine && looksLikeWatchSupervisor(parentCmdLine)) {
      console.log(`free-port: killing stale tsx-watch supervisor ${parentPid} (and its child ${pid}) holding port ${port}`);
      safeExec(`taskkill /PID ${parentPid} /T /F`);
    } else {
      console.log(`free-port: killing stale process ${pid} holding port ${port}`);
      safeExec(`taskkill /PID ${pid} /T /F`);
    }
  }
} else {
  const pids = safeExec(`lsof -ti tcp:${port} -sTCP:LISTEN`)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const pid of pids) {
    const cmdLine = safeExec(`ps -o command= -p ${pid}`);
    if (!looksLikeThisRepo(cmdLine)) {
      if (cmdLine) {
        console.warn(
          `free-port: port ${port} is held by PID ${pid}, which doesn't look like this repo's dev server -- leaving it alone.`
        );
      }
      continue;
    }

    const parentPid = safeExec(`ps -o ppid= -p ${pid}`).trim();
    const parentCmdLine = parentPid ? safeExec(`ps -o command= -p ${parentPid}`) : '';

    if (parentCmdLine && looksLikeWatchSupervisor(parentCmdLine)) {
      console.log(`free-port: killing stale tsx-watch supervisor ${parentPid} (and its child ${pid}) holding port ${port}`);
      safeExec(`kill -9 ${parentPid} ${pid}`);
    } else {
      console.log(`free-port: killing stale process ${pid} holding port ${port}`);
      safeExec(`kill -9 ${pid}`);
    }
  }
}
