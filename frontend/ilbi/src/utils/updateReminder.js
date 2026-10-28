const fallback = new Map();

/** Business-day reminders follow the shop's Tashkent date, including across restarts. */
export function updateDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

export function claimUpdateReminder(storage, { account, installed, offered, day = updateDay() }) {
  if (!account || !installed || !offered) return false;
  const key = 'ilbi:update-reminder:desktop:' + encodeURIComponent(account) + ':' + encodeURIComponent(installed);
  const value = JSON.stringify({ day, offered });
  let saved;
  try { saved = storage?.getItem(key); } catch {}
  if (saved === value || fallback.get(key) === value) return false;
  fallback.set(key, value);
  try { storage?.setItem(key, value); } catch {}
  return true;
}
