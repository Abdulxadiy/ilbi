const { app, BrowserWindow, ipcMain, safeStorage, dialog, Menu, shell, session, net, Notification } = require('electron');
const { createServer: httpServer } = require('node:http');
const { createServer: httpsServer, request: httpsRequest } = require('node:https');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { join, extname, dirname } = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { DesktopUpdater } = require('./updater.cjs');
const { publicErrorMessage, protectIpcHandler } = require('./public-errors.cjs');
const handle = (channel, listener) => ipcMain.handle(channel, protectIpcHandler(listener));
const { LoginCredentials } = require('./login-credentials.cjs');
const { forwardRequest } = require('./proxy.cjs');
const { PairingManager } = require('./pairing-manager.cjs');
const { SessionLock } = require('./session-lock.cjs');
const { Backups, protectProfile, recoverRestore } = require('./backups.cjs');
const { captureDrafts, restoreDrafts } = require('./draft-backup.cjs');
const { networkInterfaces } = require('node:os');
const { randomBytes, createHash } = require('node:crypto');
const { OFFICIAL_SERVER, validateServer, migrateStoredServer, validatePairing, privateHost, safePath, equalKey, startHost } = require('./runtime.cjs');
const { configureSecretStore, serveReleases } = require('./services.cjs');
const { saveDocumentPDF, receiptShareLinks } = require('./document-sharing.cjs');
configureSecretStore(app);
app.setName('ILBI');
if (process.platform === 'linux') app.setDesktopName('uz.ilbi.desktop.desktop');

let window, guideWindow, updateWindow, localHost, lanServer, webServer, origin, configuration, secrets, updater;
let quitting = false;
let closing = false, maintenance = false, activeRequests = 0;
let setupBusy = false;
let documentExportBusy = false;
let sessionLock, pairingManager, requiresRejoin = false;
let idleTimer,backupTimer,backups;
const bridgeKey = randomBytes(32).toString('hex');
const updateKey = randomBytes(32).toString('hex');
const dataDir = app.getPath('userData');
const resources = app.isPackaged ? process.resourcesPath : join(__dirname, process.platform === 'linux' ? 'resources-linux' : 'resources');
const uiRoot = app.isPackaged ? join(resources, 'ui') : join(__dirname, '../../frontend/ilbi/dist');
const vaultPath = join(dataDir, 'device.vault');
const savedLogins = new LoginCredentials({ directory: dataDir, safeStorage });
const applicationIcon = app.isPackaged ? join(resources, process.platform === 'linux' ? 'ilbi-desktop.png' : 'ilbi-desktop-rounded.ico')
  : process.platform === 'linux' ? join(__dirname, '../../frontend/ilbi/public/brand/ilbi-desktop-512.png') : join(__dirname, 'icon.ico');

async function openGuide(event) {
  if (event) validSender(event);
  if (guideWindow && !guideWindow.isDestroyed()) {
    if (!guideWindow.webContents.getURL().startsWith(origin + '/desktop-guide')) await guideWindow.loadURL(origin + '/desktop-guide?desktop-window=1');
    guideWindow.restore(); guideWindow.focus(); return true;
  }
  guideWindow = new BrowserWindow({ parent: window, title: 'ILBI — Ilovani sozlash', icon: applicationIcon,
    width: 1140, height: 880, minWidth: 760, minHeight: 600,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  guideWindow.setMenu(null);
  guideWindow.webContents.on('will-navigate', (navigation, url) => { if (!url.startsWith(origin + '/')) navigation.preventDefault(); });
  guideWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  guideWindow.on('closed', () => { guideWindow = null; });
  await guideWindow.loadURL(origin + '/desktop-guide?desktop-window=1');
  return true;
}

async function saveVault(nextConfiguration = configuration, nextSecrets = secrets) {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw Error(process.platform === 'linux'
    ? 'Parollar omboriga ulanib bo‘lmadi. GNOME Keyring yoki KWallet qulfini oching va ILBI’ni qayta ishga tushiring. Batafsil qadamlar rasmli qo‘llanmada.'
    : 'Tizimning maxfiy ma’lumotlar ombori ishlamayapti.');
  const value = safeStorage.encryptString(JSON.stringify({ configuration: nextConfiguration, secrets: nextSecrets }));
  await mkdir(dataDir, { recursive: true });
  await writeFile(vaultPath + '.new', value, { mode: 0o600 });
  await require('node:fs/promises').rename(vaultPath + '.new', vaultPath);
}
async function stopRuntime() {
  lanServer?.close(); lanServer = null;
  const host = localHost; localHost = null;
  await host?.stop();
}
async function workerUpdate(action) {
  if (!localHost) return;
  const response = await fetch(`http://127.0.0.1:${localHost.port}/desktop/update/${action}/`, { method: 'POST',
    headers: { 'X-ILBI-Desktop-Key': bridgeKey, 'X-ILBI-Update-Key': updateKey }, signal: AbortSignal.timeout(75000) });
  if (!response.ok) throw Error('Davom etayotgan sinxronlash hali tugamadi. Birozdan keyin qayta urinib ko‘ring.');
}
async function resumeUpdate() { maintenance = false; await workerUpdate('resume').catch(() => {}); }
async function prepareUpdate() {
  if (setupBusy || documentExportBusy) throw Error('Avval davom etayotgan sozlash yoki hujjat tayyorlash tugashini kuting.');
  maintenance = true;
  try {
    const deadline = Date.now() + 70000;
    while (activeRequests && Date.now() < deadline) await new Promise(ok => setTimeout(ok, 100));
    if (activeRequests) throw Error('Davom etayotgan ish hali tugamadi. Birozdan keyin qayta yangilang.');
    await workerUpdate('prepare');
  } catch (error) { await resumeUpdate(); throw error; }
}
async function showUpdates(event) {
  if (event) validSender(event);
  if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.restore(); updateWindow.focus(); return; }
  updateWindow = new BrowserWindow({ parent: window, title: 'ILBI yangilanishi', icon: applicationIcon, width: 560, height: 440, resizable: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  updateWindow.setMenu(null);
  updateWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  updateWindow.webContents.on('will-navigate', navigation => navigation.preventDefault());
  updateWindow.on('closed', () => { updateWindow = null; });
  await updateWindow.loadURL(origin + '/native-update');
}
async function notifyUpdate() {
  if (window?.isFocused()) return;
  // libnotify can block while activating a missing/broken notification daemon.
  // Keep the in-app notice available on minimal Linux desktops without one.
  if (process.platform === 'linux') {
    try {
      const result = await promisify(execFile)('dbus-send', ['--session', '--print-reply=literal', '--reply-timeout=1000',
        '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', 'string:org.freedesktop.Notifications'], { timeout: 2000 });
      if (!/boolean\s+true/.test(result.stdout)) return;
    } catch { return; }
  }
  if (!Notification.isSupported()) return;
  const notice = new Notification({ title: 'ILBI yangilanishi', body: 'Ochiq shakllarni saqlang. Yuklab olish va yangilash uchun bosing.', icon: applicationIcon });
  notice.on('click', () => {
    window?.restore(); window?.focus();
    void showUpdates().then(() => updater.update()).catch(error => updater.set({ phase: 'error', message: error.message }));
  }); notice.show();
}
async function applyUpdate(archive, release) {
  if (!app.isPackaged) throw Error('Yangilash rasmiy o‘rnatilgan ILBI ilovasida ishlaydi.');
  if(backups?.busy)throw Error('Avval zaxira yoki tiklash tugashini kuting.');
  await prepareUpdate();
  try {
    if (process.platform === 'win32') {
      if ((await readFile(join(dirname(process.execPath), 'ilbi-installation.id'), 'utf8')).trim() !== 'uz.ilbi.desktop') throw Error('Avval rasmiy ILBI o‘rnatuvchisidan foydalaning.');
      const child = spawn(archive, ['/ILBIUPDATE'], { detached: true, stdio: 'ignore',
        env: { ...process.env, ILBI_UPDATE_INSTALL_DIRECTORY: dirname(process.execPath) } });
      await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail); });
      child.once('exit', () => { if (!quitting && !closing) void resumeUpdate().then(() => updater.set({ phase: 'error', message: 'O‘rnatish tugallanmadi. Yana urinib ko‘rishingiz mumkin.' })); });
      child.unref();
    } else if (process.platform === 'linux') {
      const dataHome = process.env.XDG_DATA_HOME || join(app.getPath('home'), '.local/share');
      const binDirectory = process.env.ILBI_INSTALL_BIN_DIR || join(app.getPath('home'), '.local/bin');
      const jobPath = join(dataDir, 'updates', 'install-job.json');
      const job = { archive, sourceCommit: release.sourceCommit, sha256: release.sha256, bytes: release.bytes,
        parentPid: process.pid, dataHome, binDirectory, launcher: join(binDirectory, 'ilbi'), python: join(resources, 'backend/python/bin/python3') };
      await writeFile(jobPath, JSON.stringify(job), { mode: 0o600 });
      await require('node:fs/promises').rm(jobPath + '.ready', { force: true });
      const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawn(process.execPath, [`--ilbi-update-helper=${jobPath}`], { detached: true, stdio: 'ignore', env: environment });
      await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail); }); child.unref();
      let ready = false;
      for (let i = 0; i < 150; i++) {
        try { await readFile(jobPath + '.ready'); ready = true; break; } catch {}
        await new Promise(ok => setTimeout(ok, 100));
      }
      if (!ready) throw Error('Yangilash oynasini ochib bo‘lmadi. Qayta urinib ko‘ring.');
      setTimeout(() => app.quit(), 250);
    } else throw Error('Bu tizim uchun yangilanish hali mavjud emas.');
  } catch (error) { await resumeUpdate(); throw error; }
}
function validSender(event, setupOnly = false) {
  const url = new URL(event.senderFrame.url);
  if (url.origin !== origin || (setupOnly && url.pathname !== '/setup')) throw Error('So‘rov manbasi tasdiqlanmadi.');
}
function mainSender(event, setupOnly=false) {
  validSender(event,setupOnly);
  if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('So‘rov manbasi tasdiqlanmadi.');
}
function tokenClaims(token){try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{return {};}}
async function localRequest(path,token,body){
  if(token!==undefined&&(typeof token!=='string'||token.length>8192))throw Error('Hisob sessiyasi noto‘g‘ri.');
  const headers={'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};
  if(path.startsWith('/api/')&&token&&!tokenClaims(token).desktop_device)headers['X-ILBI-Cloud-Session']='true';
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers,
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(35000)});
  const value=await response.json();
  if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'Amalni bajarib bo‘lmadi. Hisob va internet ulanishini tekshiring.');
  return value;
}
async function publicPairingRequest(kind,body){
  if(!['claim','result'].includes(kind))throw Error('Ulanish amali noto‘g‘ri.');
  let response;
  try{response=await net.fetch(OFFICIAL_SERVER+'/api/v1/sync/pairings/'+kind+'/',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw Error('Birinchi ulash uchun internet kerak. Internetga ulanib qayta urinib ko‘ring.');}
  const value=await response.json();if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'Ulanish kodi tasdiqlanmadi. Yangi kod oling.');return value;
}
async function probePairing(pairing){
  return new Promise((ok,fail)=>{
    const request=httpsRequest({host:pairing.host,port:pairing.port,path:'/desktop/status/',method:'GET',ca:pairing.certificate,
      checkServerIdentity:()=>undefined,rejectUnauthorized:true,timeout:5000,headers:{'X-ILBI-Desktop-Key':pairing.key}},response=>{
      let body='';response.on('data',chunk=>{body+=chunk;if(body.length>4096)response.destroy();});
      response.on('error',fail);response.on('end',()=>{try{if(response.statusCode!==200)throw Error('Asosiy kassa ruxsati tasdiqlanmadi.');ok(JSON.parse(body));}catch(error){fail(error);}});
    });
    request.on('timeout',()=>request.destroy());request.on('error',()=>fail(Error('Asosiy kassaga ulanib bo‘lmadi. Ikkala kompyuterni bir xil Wi-Fi yoki kabel tarmog‘iga ulang.')));request.end();
  });
}
async function commitConfiguration(next){await saveVault(next);configuration=next;requiresRejoin=next?.mode==='client'&&!next.pairing.registerId;}
async function selectLANAddress(){
  const addresses=Object.entries(networkInterfaces()).flatMap(([name,items])=>
    /^(docker|veth|br-|virbr|vmnet|vboxnet|tailscale|tun|tap)/i.test(name)?[]:
      items.filter(item=>item.family==='IPv4'&&!item.internal&&privateHost(item.address)).map(item=>({name,address:item.address})));
  if(!addresses.length)throw Error('Mahalliy tarmoq topilmadi. Wi-Fi yoki kabelni ulang.');
  if(addresses.length===1)return addresses[0].address;
  const choice=await dialog.showMessageBox(window,{type:'question',title:'Kassalar tarmog‘i',message:'Boshqa kassa ulangan tarmoqni tanlang.',
    buttons:[...addresses.map(item=>`${item.name}: ${item.address}`),'Bekor qilish'],cancelId:addresses.length});
  if(choice.response===addresses.length)throw Error('Ulanish bekor qilindi.');return addresses[choice.response].address;
}
async function configureLAN(){
  if(configuration?.mode!=='host')return;
  if(!(configuration.registers||[]).length){lanServer?.close();lanServer?.closeIdleConnections();lanServer=null;return;}
  if(lanServer)return;
  lanServer=httpsServer({cert:await readFile(join(dataDir,'lan.crt')),key:await readFile(join(dataDir,'lan.key'))},(req,res)=>{
    const register=(configuration.registers||[]).find(row=>equalKey(req.headers['x-ilbi-desktop-key'],row.key));
    if(!register||!/^\/(api\/v1\/|desktop\/|media\/)/.test(req.url)){res.writeHead(403);res.end();return;}
    register.lastSeen=new Date().toISOString();
    proxy(req,res,{host:'127.0.0.1',port:localHost.port},false,register.id,true);
  });
  try{await new Promise((ok,fail)=>{lanServer.once('error',fail);lanServer.listen(configuration.lanPort||49243,'0.0.0.0',ok);});}
  catch(error){lanServer.close();lanServer=null;throw error;}
}
function proxy(request, response, target, secure = false, register = 'primary', fromLAN = false) {
  if (maintenance) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ detail: backups?.busy?'ILBI zaxirasi tayyorlanmoqda. Biroz kuting.':'ILBI yangilanmoqda. Biroz kuting.' })); return; }
  const path=request.url.split('?')[0];
  const loginRequest=path.startsWith('/api/v1/auth/admin-login')||path.startsWith('/api/v1/auth/password-reset')||
    ['/desktop/unlock/','/desktop/session/','/desktop/status/','/desktop/lock/','/desktop/register-start/'].includes(path);
  const publicSupport=!request.headers.authorization&&(path.startsWith('/api/v1/support/guest/')||path==='/api/v1/support/metadata/');
  const publicDocs=path.startsWith('/api/v1/docs/');
  if(!fromLAN&&sessionLock?.locked&&!loginRequest&&!publicSupport&&!publicDocs&&/^\/(api|desktop|media)\//.test(path)){
    response.writeHead(423,{'Content-Type':'application/json'});response.end(JSON.stringify({detail:'Kassa qulflangan. Hisobingiz bilan qayta kiring.',code:'desktop_locked'}));return;
  }
  activeRequests++;
  const lockGeneration=sessionLock?.generation;
  const headers = { ...request.headers, host: secure ? target.host : '127.0.0.1', 'x-ilbi-desktop-key': secure ? configuration.pairing.key : bridgeKey };
  if(!fromLAN&&path.startsWith('/media/')&&sessionLock?.active?.token){
    headers.authorization='Bearer '+sessionLock.active.token;
    if(!tokenClaims(sessionLock.active.token).desktop_device)headers['x-ilbi-cloud-session']='true';
  }
  headers['x-ilbi-register-id']=secure?configuration.pairing.registerId:register;
  delete headers['x-ilbi-update-key'];
  delete headers.connection;
  forwardRequest(request, response, { ...target, path: request.url, method: request.method, headers,
    timeout: 65000, ...(secure ? { ca: configuration.pairing.certificate, checkServerIdentity: () => undefined, rejectUnauthorized: true } : {}) }, secure, (status,upstreamHeaders) => {
      activeRequests--;
      if(!fromLAN&&status===200&&sessionLock?.generation===lockGeneration&&(
        ['/desktop/unlock/','/desktop/session/'].includes(path)||path.startsWith('/api/v1/auth/admin-login')&&upstreamHeaders?.['x-ilbi-account-verified']==='1'
      ))void sessionLock.unlock().catch(()=>{});
    });
}
async function launchRuntime() {
  // Recheck persisted settings before starting any service or forwarding credentials.
  if (configuration.mode === 'client') { configuration.pairing = validatePairing(configuration.pairing);requiresRejoin=!configuration.pairing.registerId; }
  else if (configuration.mode !== 'host') throw Error('Qurilma sozlamalari noto‘g‘ri. Yordam xizmatiga murojaat qiling.');
  if (configuration.mode === 'host') {
    configuration.server = validateServer(configuration.server);
    localHost = await startHost({ resources, dataDir, secrets, bridgeKey, updateKey, server: configuration.server,
      executable: join(resources, process.platform === 'win32' ? 'backend/python/python.exe' : 'backend/python/bin/python3'),
      runtimeArguments: [join(resources, 'backend/runtime.py')] });
    await configureLAN();
  }
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); if (closing) return; closing = true;
  Promise.resolve().then(async () => {
    // The first login screen can render before its setup IPC has settled.
    // Finish that save/load (or a document export) before closing the runtime.
    const deadline = Date.now() + 70000;
    while ((setupBusy || documentExportBusy || backups?.busy) && Date.now() < deadline) await new Promise(ok => setTimeout(ok, 100));
    if(backups?.busy)throw Error('Zaxira tugashini kuting.');
    if (!maintenance) await prepareUpdate();
    clearInterval(idleTimer);clearInterval(backupTimer);updater?.stop(); webServer?.close(); await stopRuntime(); quitting = true; app.quit();
  })
    .catch(async error => { console.error('ILBI yopilishi:', publicErrorMessage(error)); closing = false; await resumeUpdate(); dialog.showErrorBox('ILBI yopilishi', publicErrorMessage(error)); });
});
if (!app.requestSingleInstanceLock() || process.argv.includes('--ilbi-quit-for-update')) app.quit();
else {
  app.on('second-instance', (_event, arguments_) => { if (arguments_.includes('--ilbi-quit-for-update')) app.quit(); else { window?.restore(); window?.focus(); } });
  app.whenReady().then(async () => {
    try {
      await protectProfile(dataDir);
      try{
        await readFile(join(dataDir,'restore.journal'));
        await promisify(execFile)(join(resources,'postgres/bin/pg_ctl'+(process.platform==='win32'?'.exe':'')),['-D',join(dataDir,'postgres'),'-m','fast','-w','stop'],{windowsHide:true}).catch(()=>{});
        await recoverRestore(dataDir);
      }catch(error){if(error.code!=='ENOENT')throw error;}
      sessionLock=new SessionLock({directory:dataDir,authorize:token=>localRequest('/api/v1/auth/me/',token),onLock:async token=>{
        if(sessionLock.locked&&!window?.isDestroyed())window?.webContents.send('ilbi:session-locked');
        if(token)await localRequest('/desktop/lock/',token,{});
      }});
      await sessionLock.initialize();
      try { ({ configuration, secrets } = JSON.parse(safeStorage.decryptString(await readFile(vaultPath)))); }
      catch (error) { if (error.code !== 'ENOENT') throw Error('Qurilma sozlamalarini ochib bo‘lmadi. device.vault faylini o‘chirmang; tizim hisobingiz va maxfiy ma’lumotlar omborini tekshiring.'); }
      if (configuration?.mode === 'host') {
        const server = migrateStoredServer(configuration.server);
        if (server !== configuration.server) {
          const nextConfiguration = { ...configuration, server };
          await saveVault(nextConfiguration, secrets);
          configuration = nextConfiguration;
        }
      }
      if (configuration) await launchRuntime();
      let current;
      try { current = require('./build-info.json'); } catch { current = { version: app.getVersion(), sourceCommit: null, buildTimestamp: 0 }; }
      updater = new DesktopUpdater({ current, cache: join(dataDir, 'updates'), fetcher: (...args) => net.fetch(...args), install: applyUpdate });
      module.exports.updater = updater;
      updater.on('status', status => { for (const target of [window, guideWindow, updateWindow]) if (target && !target.isDestroyed()) target.webContents.send('ilbi:update-status', status); });
      updater.on('available', () => { void notifyUpdate().catch(() => {}); });
      webServer = httpServer(async (req, res) => {
        try {
          if (req.headers.origin && req.headers.origin !== origin) { res.writeHead(403); res.end(); return; }
          const url = new URL(req.url, 'http://localhost');
          if (url.pathname === '/desktop/app-update/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(updater.status())); return; }
          if (url.pathname === '/desktop/releases/') { await serveReleases(req, res, (...args) => net.fetch(...args)); return; }
          if (/^\/(api\/|desktop\/|media\/)/.test(url.pathname)) {
            if (!configuration || requiresRejoin || (configuration.mode === 'host' && !localHost)) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ detail: 'Avval ILBI sozlash oynasidagi Ishni boshlash tugmasini bosing.', code: 'setup_required' })); return;
            }
            return configuration.mode === 'host' ? proxy(req, res, { host: '127.0.0.1', port: localHost.port })
              : proxy(req, res, { host: configuration.pairing.host, port: configuration.pairing.port }, true);
          }
          const native = { '/setup': 'setup.html', '/setup.css': 'setup.css', '/setup.js': 'setup.js', '/native-update': 'update.html', '/update.css': 'update.css', '/update-window.js': 'update-window.js' };
          const setup = Boolean(native[url.pathname]);
          let path = setup ? join(__dirname, native[url.pathname]) : safePath(uiRoot, url.pathname);
          let body;
          try { body = await readFile(path); } catch { if (setup || extname(path)) { res.writeHead(404); res.end(); return; } path = join(uiRoot, 'index.html'); body = await readFile(path); }
          let scriptHashes = '';
          if (extname(path) === '.html') {
            const markup = body.toString('utf8').replace(/<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/g, '');
            scriptHashes = [...markup.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => ` 'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join('');
            body = Buffer.from(markup);
          }
          const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }[extname(path)] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'self'; script-src 'self'${scriptHashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` });
          res.end(body);
        } catch { res.writeHead(500); res.end('ILBI local service error'); }
      });
      // A stable origin preserves account drafts and session storage across restarts.
      await new Promise((ok, fail) => { webServer.once('error', fail); webServer.listen(49244, '127.0.0.1', ok); });
      origin = `http://127.0.0.1:${webServer.address().port}`;
      pairingManager=new PairingManager({
        relay:(token,body)=>localRequest('/desktop/pairing-relay/',token,body),publicRequest:publicPairingRequest,
        getConfiguration:()=>configuration,saveConfiguration:commitConfiguration,enableLAN:configureLAN,
        selectAddress:selectLANAddress,certificate:()=>readFile(join(dataDir,'lan.crt'),'utf8'),probe:probePairing,
        navigate:async()=>{
          await localRequest('/desktop/register-start/',undefined,{});await sessionLock.lock();
          await window.loadURL(origin+'/login');
        },name:require('node:os').hostname().slice(0,80),
      });
      function getBackups(){
        if(configuration?.mode!=='host'||!secrets)throw Error('Zaxira asosiy kompyuterda saqlanadi.');
        if(!backups)backups=new Backups({directory:dataDir,key:secrets.vaultKey,
          python:join(resources,process.platform==='win32'?'backend/python/python.exe':'backend/python/bin/python3'),
          helper:join(resources,'backend/backup_store.py'),
          quiesce:async()=>{await prepareUpdate();await stopRuntime();},
          resume:async()=>{if(!localHost)await launchRuntime();await resumeUpdate();},
          getDrafts:()=>window.webContents.executeJavaScript(`(${captureDrafts.toString()})()`),
          setDrafts:async drafts=>{
            await sessionLock.lock();
            await window.loadURL(origin+'/login');
            await window.webContents.executeJavaScript(`(${restoreDrafts.toString()})(${JSON.stringify(drafts)})`);
          },
        });return backups;
      }
      handle('ilbi:backup-status',async(event,token)=>{mainSender(event);await localRequest('/desktop/owner-authorize/',token,{});return getBackups().status();});
      handle('ilbi:backup-create',async(event,token)=>{mainSender(event);await localRequest('/desktop/owner-authorize/',token,{event:'backup_created'});await getBackups().create();return getBackups().status();});
      handle('ilbi:backup-restore',async(event,token,id,password)=>{
        mainSender(event);await localRequest('/desktop/owner-authorize/',token,{reauth_password:password,event:'backup_restore_requested'});
        if(typeof password!=='string'||!password)throw Error('Odatiy hisob parolingiz bilan tasdiqlang.');
        const choice=await dialog.showMessageBox(window,{type:'warning',title:'Zaxiradan tiklash',
          message:'Tanlangan zaxiraga qaytasiz. Davom etilsin?',detail:'Hozirgi baza avval alohida shifrlangan zaxiraga saqlanadi. Tanlangan zaxiradagi sotuvlar, navbat va rasmlar tiklanadi. Keyingi ishlar yangi zaxirada qoladi. Tiklashdan so‘ng qayta kirasiz.',
          buttons:['Bekor qilish','Zaxiradan tiklash'],defaultId:0,cancelId:0});
        if(choice.response!==1)return {cancelled:true};return getBackups().restore(id);
      });
      backupTimer=setInterval(()=>{
        if(closing||maintenance||setupBusy||activeRequests||configuration?.mode!=='host'||!sessionLock.active||backups?.busy)return;
        if(sessionLock.clock()-sessionLock.lastActivity<60000)return;
        void localRequest('/desktop/status/').then(async status=>{
          if(!status.enrolled)return;const manager=getBackups(),rows=await manager.list();
          if(!rows.length||Date.now()-rows[0].created>86400000)await manager.create();
        }).catch(()=>{});
      },60000);backupTimer.unref();
      handle('ilbi:setup', async event => {
        validSender(event, true);
        if (setupBusy) throw Error('Kassa tayyorlanmoqda. Biroz kuting.');
        if (configuration && (configuration.mode !== 'host' || localHost)) throw Error('Qurilma allaqachon sozlangan.');
        setupBusy = true;
        try {
          if (!configuration) {
            const nextConfiguration = { mode: 'host', server: OFFICIAL_SERVER, lanPort: 49243 };
            const nextSecrets = { djangoSecret: randomBytes(48).toString('hex'), databasePassword: randomBytes(32).toString('hex'),
              vaultKey: randomBytes(32).toString('base64url') + '=', pairingKey: randomBytes(32).toString('hex') };
            // Commit in-memory state only after encrypted persistence succeeds.
            await saveVault(nextConfiguration, nextSecrets);
            configuration = nextConfiguration; secrets = nextSecrets;
          }
          try { await launchRuntime(); }
          catch (error) { await stopRuntime().catch(() => {}); throw error; }
          await window.loadURL(origin + '/login');
        } finally { setupBusy = false; }
      });
      handle('ilbi:join', async (event, code) => {
        mainSender(event,true);
        return pairingManager.join(code);
      });
      handle('ilbi:join-state', event=>{mainSender(event,true);return pairingManager.joinState();});
      handle('ilbi:setup-state',event=>{mainSender(event);return {mode:configuration?.mode||null,requiresRejoin};});
      handle('ilbi:pair-create',(event,token)=>{mainSender(event);return pairingManager.create(token);});
      handle('ilbi:pair-state',(event,token,id)=>{mainSender(event);return pairingManager.state(token,id);});
      handle('ilbi:pair-approve',(event,token,id,expected)=>{mainSender(event);return pairingManager.approve(token,id,expected);});
      handle('ilbi:pair-cancel',(event,token,id)=>{mainSender(event);return pairingManager.cancel(token,id);});
      handle('ilbi:registers',async(event,token)=>{
        mainSender(event);await localRequest('/desktop/owner-authorize/',token,{});
        return (configuration?.registers||[]).map(({id,name,createdAt,lastSeen})=>({id,name,createdAt,lastSeen}));
      });
      handle('ilbi:register-revoke',async(event,token,id)=>{
        mainSender(event);await localRequest('/desktop/owner-authorize/',token,{event:'register_revoked'});
        if(configuration?.mode!=='host')throw Error('Kassani asosiy kompyuterda uzing.');
        await commitConfiguration({...configuration,registers:(configuration.registers||[]).filter(row=>row.id!==id)});
        await configureLAN();return true;
      });
      handle('ilbi:pairing',event=>{mainSender(event);window.webContents.send('ilbi:open-security');return true;});
      handle('ilbi:guide', openGuide);
      handle('ilbi:downloads', event => { validSender(event); return shell.openExternal(OFFICIAL_SERVER + '/download'); });
      handle('ilbi:update-status', event => { validSender(event); return updater.status(); });
      handle('ilbi:update-check', event => { validSender(event); return updater.check(); });
      handle('ilbi:update-window', showUpdates);
      handle('ilbi:update-run', async event => { validSender(event); await showUpdates(); return updater.update(); });
      const loginSender = event => {
        validSender(event);
        if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).pathname !== '/login') throw Error('Kirish ma’lumotlari faqat kirish oynasida ochiladi.');
      };
      handle('ilbi:login-read', async (event, kind) => {
        loginSender(event);
        return savedLogins.forLogin(kind, sessionLock);
      });
      handle('ilbi:login-save', (event, kind, value) => { loginSender(event); return savedLogins.save(kind, value); });
      handle('ilbi:login-forget', (event, kind) => { loginSender(event); return savedLogins.forget(kind); });
      handle('ilbi:session-lock', async (event, token, reason) => {
        validSender(event);
        if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('So‘rov manbasi tasdiqlanmadi.');
        if (typeof token !== 'string' || token.length > 8192) return false;
        return sessionLock.lock(token,reason==='explicit'?'explicit':'manual');
      });
      handle('ilbi:session-activate',(event,token)=>{mainSender(event);return sessionLock.activate(token);});
      handle('ilbi:session-activity',event=>{mainSender(event);sessionLock.touch();return true;});
      handle('ilbi:session-state',event=>{mainSender(event);return {locked:sessionLock.locked,reason:sessionLock.reason};});
      handle('ilbi:session-timeout',async(event,token,minutes)=>{
        mainSender(event);await localRequest('/desktop/owner-authorize/',token,{});
        if(!Number.isInteger(minutes)||minutes<1||minutes>60)throw Error('Qulflash vaqti 1–60 daqiqa bo‘lsin.');
        await localRequest('/desktop/security-settings/',token,{idle_minutes:minutes});
        await commitConfiguration({...configuration,idleMinutes:minutes});sessionLock.idleMinutes=minutes;return true;
      });
      const validDocumentSender = event => {
        validSender(event);
        if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('So‘rov manbasi tasdiqlanmadi.');
      };
      handle('ilbi:receipt-share-links', (event, tokens) => {
        validDocumentSender(event);
        return receiptShareLinks(tokens, (...args) => net.fetch(...args));
      });
      handle('ilbi:document-pdf', async (event, document) => {
        validDocumentSender(event);
        if (documentExportBusy) throw Error('Boshqa PDF tayyorlanmoqda. Biroz kuting.');
        documentExportBusy = true;
        try { return await saveDocumentPDF({ document, parent: window, BrowserWindow, dialog }); }
        finally { documentExportBusy = false; }
      });
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'media' && contents.getURL().startsWith(origin + '/')));
      app.setAppUserModelId('uz.ilbi.desktop');
      window = new BrowserWindow({ title: 'ILBI', icon: applicationIcon, width: 1440, height: 960, minWidth: 900, minHeight: 650,
        webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
      sessionLock.idleMinutes=Math.min(60,Math.max(1,configuration?.idleMinutes||10));
      idleTimer=setInterval(()=>{void sessionLock.check().catch(()=>{});},1000);idleTimer.unref();
      window.webContents.on('before-input-event',()=>sessionLock.touch());
      window.on('close', event => { if (!quitting) { event.preventDefault(); app.quit(); } else { guideWindow?.close(); updateWindow?.close(); } });
      window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) event.preventDefault(); });
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (url === 'about:blank' || url === '') return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } } };
        if (url.startsWith('https://')) void shell.openExternal(url);
        return { action: 'deny' };
      });
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'ILBI', submenu: [
        { label: 'Ilovani sozlash (rasmli qo‘llanma)', click: () => openGuide().catch(error => dialog.showErrorBox('ILBI', publicErrorMessage(error))) },
        { label: 'Kassalar va xavfsizlik', click: () => {
          if(['/login','/setup'].includes(new URL(window.webContents.getURL()).pathname))void dialog.showMessageBox(window,{message:'Avval hisobingizga kiring.',detail:'Kassalar va xavfsizlik sozlamalari hisobingiz ochilgach ishlaydi.'});
          else window.webContents.send('ilbi:open-security');
        } },
        { label: 'Asosiy kassaga qayta ulanish', enabled: configuration?.mode === 'client', click: () => window.loadURL(origin+'/setup?rejoin=1') },
        { label: 'Yangilanishni tekshirish', click: () => { void showUpdates(); void updater.check(); } },
        { label: 'Dastur haqida', click: () => dialog.showMessageBox(window, { message: `ILBI ${app.getVersion()}`, detail: 'Yangilanish xabaridan yoki ILBI menyusidan ilovani yangilang. Mahalliy baza va yuborilmagan ishlar saqlanadi.' }) },
        { type: 'separator' }, { role: 'quit', label: 'Chiqish' },
      ] }, { label: 'Ko‘rinish', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'resetzoom' }, { role: 'zoomin' }, { role: 'zoomout' }] }]));
      if (configuration&&!requiresRejoin) {
        const response = await fetch(origin + '/desktop/register-start/', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
        if (!response.ok) throw Error('Kassa xavfsizlik holatini tekshirib bo‘lmadi.');
        const status=await localRequest('/desktop/status/');if(status.unlock_required)await sessionLock.lock();
      }
      await window.loadURL(origin + (configuration&&!requiresRejoin ? '/login' : '/setup'));
      if (process.argv.includes('--ilbi-updated')) updater.set({ phase: 'updated', message: 'ILBI muvaffaqiyatli yangilandi.' });
      if (process.argv.includes('--ilbi-update-failed')) updater.set({ phase: 'error', message: 'Yangilanish o‘rnatilmadi. Avvalgi ILBI qayta ochildi.' });
      updater.start();
    } catch (error) { if (!closing && !quitting) dialog.showErrorBox('ILBI ishga tushmadi', publicErrorMessage(error)); app.quit(); }
  });
}
