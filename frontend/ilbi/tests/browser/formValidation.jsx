import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import PriceInput from '../../src/components/common/PriceInput';
import PhoneInput from '../../src/components/common/PhoneInput';
import CustomSelect from '../../src/components/common/CustomSelect';
import CustomDatePicker from '../../src/components/common/CustomDatePicker';
import { request } from '../../src/api/client';
import { installFormValidation } from '../../src/utils/formValidation.js';

installFormValidation();
window.validationQA = { requests: [], hold: false, pending: [], errors: {}, status: 400 };
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, options = {}) => {
  if (!new URL(input, location.origin).pathname.startsWith('/api/v1/validation-fixture/')) return nativeFetch(input, options);
  const body = JSON.parse(options.body || '{}');
  const errors = structuredClone(validationQA.errors), status = validationQA.status;
  validationQA.requests.push(body);
  if (validationQA.hold) await new Promise(resolve => validationQA.pending.push(resolve));
  return new Response(JSON.stringify({ error: { code: 'validation_error', message: validationQA.message || 'Synthetic rejection', details: errors } }), { status, headers: { 'Content-Type': 'application/json' } });
};

export default function Example() {
  const [form, setForm] = useState({ code: 'ITEM-1', email: '', price: '0', phone_number: '', category_id: '', date_of_birth: '2020-01-02', new_password: '' });
  const [error, setError] = useState('');
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault(); setError('');
    try { await request('/validation-fixture/', { method: 'POST', body: form }); }
    catch (failure) { validationQA.lastFailure = failure; setError(failure.message); }
  };
  return <main style={{ padding: 40, maxWidth: 600 }}><form id="core-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
    <label>Code<input id="code" data-api-field="code" className="input-field" value={form.code} onChange={event => set('code', event.target.value)} /></label>
    <label>Password<input id="qa-password" type="password" data-api-field="new_password" className="input-field" value={form.new_password} onChange={event => set('new_password', event.target.value)} /></label>
    <label>Email<input id="email" name="email" type="email" className="input-field" required value={form.email} onChange={event => set('email', event.target.value)} /></label>
    <label>Amount<PriceInput id="price" data-api-field="price" min={1} required value={form.price} onChange={event => set('price', event.target.value)} /></label>
    <label>Phone<PhoneInput id="phone" data-api-field="phone_number" value={form.phone_number} onChange={event => set('phone_number', event.target.value)} /></label>
    <div>Category<CustomSelect data-api-field="category_id" required fullWidth aria-label="Category" value={form.category_id} onChange={value => set('category_id', value)} options={[{ value: '1', label: 'First' }, { value: '2', label: 'Second' }]} /></div>
    <div>Date<CustomDatePicker data-api-field="date_of_birth" fullWidth value={form.date_of_birth} onChange={value => set('date_of_birth', value)} /></div>
    <button id="submit" className="btn btn-primary">Save</button>
  </form><div id="summary" role="status">{error}</div><button id="unrelated" type="button" onClick={() => { void request('/validation-fixture/background/', { method: 'POST', body: { email: form.email } }).catch(() => {}); }}>Unrelated action</button></main>;
}
createRoot(document.getElementById('root')).render(<Example />);
