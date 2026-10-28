const { app, BrowserWindow, ipcMain } = require('electron');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { publicErrorMessage } = require('./public-errors.cjs');
const pause = ms => new Promise(ok => setTimeout(ok, ms));
async function run(jobPath) {
  const job = JSON.parse(await readFile(jobPath, 'utf8'));
  if (!Number.isSafeInteger(job.parentPid) || job.parentPid < 1 || !/^[a-f0-9]{40}$/.test(job.sourceCommit) || !/^[a-f0-9]{64}$/.test(job.sha256)) throw Error('Yangilash topshirig‘i noto‘g‘ri.');
  const helperProfile = join(resolve(jobPath, '..'), 'helper-profile');
  await mkdir(helperProfile, { recursive: true, mode: 0o700 });
  app.setPath('userData', helperProfile);
  app.on('window-all-closed', () => app.quit());
  await app.whenReady();
  let state = { phase: 'installing', progress: null, message: 'ILBI yopilishi kutilmoqda…' };
  const window = new BrowserWindow({ title: 'ILBI yangilanmoqda', width: 520, height: 350, resizable: false,
    webPreferences: { preload: join(__dirname, 'update-helper-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.handle('ilbi:update-progress', event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Invalid sender');
    return state;
  });
  let completed = false;
  window.on('close', event => { if (!completed) event.preventDefault(); });
  await window.loadFile(join(__dirname, 'update.html'));
  await writeFile(jobPath + '.ready', '1', { mode: 0o600 });
  const send = values => { state = { ...state, ...values }; window.webContents.send('ilbi:update-status', state); };
  const reopen = failed => {
    const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(job.launcher, [failed ? '--ilbi-update-failed' : '--ilbi-updated'], { detached: true, stdio: 'ignore', env: environment });
    child.unref();
  };
  try {
    let exited = false;
    for (let i = 0; i < 1800; i++) {
      try { process.kill(job.parentPid, 0); } catch (error) { if (error.code === 'ESRCH') { exited = true; break; } throw error; }
      await pause(100);
    }
    if (!exited) throw Error('ILBI hali yopilmadi. Ilova o‘zgartirilmadi.');
    send({ message: 'Yangilanish o‘rnatilmoqda. Saqlangan savdo va sinxronlash navbati saqlanadi.' });
    await new Promise((ok, fail) => {
      const script = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked/apply-linux-update.py') : join(__dirname, 'apply-linux-update.py');
      const child = spawn(job.python, [script, jobPath], { stdio: 'ignore' });
      child.once('error', fail); child.once('exit', code => code === 0 ? ok() : fail(Error('Yangilanish o‘rnatilmadi. Avvalgi ILBI qayta ochiladi.')));
    });
    send({ phase: 'updated', progress: 100, message: 'Yangilanish o‘rnatildi. ILBI ochilmoqda…' }); reopen(false);
    completed = true; await pause(1200); app.quit();
  } catch (error) {
    completed = true; send({ phase: 'failed', message: publicErrorMessage(error) }); reopen(true);
  }
}
module.exports = { run };
