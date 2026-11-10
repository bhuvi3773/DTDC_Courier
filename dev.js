const { spawn, execSync } = require('node:child_process');
const path = require('node:path');

const root = __dirname;
const isWin = process.platform === 'win32';

function launch(name, cwd) {
  const proc = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm run dev'], {
        cwd,
        stdio: 'inherit',
      })
    : spawn('npm', ['run', 'dev'], {
        cwd,
        stdio: 'inherit',
      });

  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
  return proc;
}

console.log('Starting BookCourier Backend (http://localhost:4000) & Frontend (http://localhost:3000)...');
const backend = launch('backend', path.join(root, 'backend'));
const frontend = launch('frontend', path.join(root, 'frontend'));

function terminateTree(proc) {
  if (!proc || !proc.pid) return;
  if (isWin) {
    try {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // process already exited
    }
  } else {
    proc.kill('SIGTERM');
  }
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  terminateTree(backend);
  terminateTree(frontend);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
