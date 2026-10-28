import AsyncStorage from '@react-native-async-storage/async-storage';

export interface OutboxItem {
  id: string;
  type: 'sale' | 'debt_payment' | 'create_customer';
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH';
  payload: unknown;
  tenantId: string | null;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'processing' | 'failed' | 'completed';
  lastError?: string;
}

const KEY = '@ilbi_outbox_v1';
const blocked = () => { throw Error('Eski offline navbat tekshirish uchun saqlandi. Hisob/do‘kon izolyatsiyasi va qayta yuborish tekshirilmaguncha yuborish yoki o‘chirish mumkin emas.'); };

/** Legacy records have no account identity. Preserve them; never replay under a new login. */
export const outboxManager = {
  async getQueue(): Promise<OutboxItem[]> {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) throw Error('Offline navbatni o‘qib bo‘lmadi; saqlangan ma’lumot o‘zgartirilmadi.');
    return queue;
  },
  async enqueue(..._args: unknown[]): Promise<never> { return blocked(); },
  async remove(..._args: unknown[]): Promise<never> { return blocked(); },
  async clear(): Promise<never> { return blocked(); },
  async processQueue(): Promise<{ processed: number; failed: number; blocked: number }> {
    const queue = await this.getQueue();
    return { processed: 0, failed: 0, blocked: queue.filter(item => item.status !== 'completed').length };
  },
};
