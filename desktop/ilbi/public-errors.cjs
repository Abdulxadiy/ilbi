const FALLBACK = 'Amalni bajarib bo‘lmadi. Qayta urinib ko‘ring.';
function publicErrorMessage(value, fallback = FALLBACK) {
  const raw = typeof value === 'string' ? value : value?.message;
  if (typeof raw !== 'string') return fallback;
  const message = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').trim();
  // Internal process/network failures can echo credentials, SQL or local paths.
  if (!message || message.length > 500 || /[\r\n]|Traceback|Command failed:|\b(?:EACCES|ENOENT|EPERM|EADDRINUSE|ECONNREFUSED|ERR_[A-Z_]+)\b|-----BEGIN|\b(?:pbkdf2_sha256|scrypt|argon2)\$|\$2[aby]\$|\b[a-f0-9]{64,}\b|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b|Bearer\s|(?:password|passwd|secret|token|authorization|api_key)\s*[=:]|\w+:\/\/[^\s/@]+:[^\s/@]+@|[?&](?:token|key|password|secret)=/i.test(message)) return fallback;
  return message;
}
function protectIpcHandler(listener) {
  return async (...args) => {
    try { return await listener(...args); }
    catch (error) { throw new Error(publicErrorMessage(error)); }
  };
}
module.exports = { publicErrorMessage, protectIpcHandler };
