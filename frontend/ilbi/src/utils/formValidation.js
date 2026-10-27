// Shared browser/Electron renderer validation. Never infer a bad field from a
// general server/network error, and never attach an old response to edited data.
import { safeDisplayText } from './safePresentation.js';
const messages = new WeakMap();
const revisions = new WeakMap();
const touched = new WeakSet();
const submissions = new Map();
let sequence = 0;
let activeSubmission = null;
const controls = 'input,select,textarea';
const nonFieldKeys = new Set(['non_field_errors', '__all__']);
const envelopeKeys = new Set(['detail', 'message', 'code', 'error']);
const privateMetadata = /^(?:guest_hash|password_hash|request_fingerprint|access|refresh|token|access_token|refresh_token|login_ticket|api_key|private_key|secret|authorization|cookie)$/i;
const normalize = value => String(value || '').replace(/\[(\d+)\]/g, '.$1').replace(/-/g, '_');

export function validationFields(data) {
  const explicitFields = data?.error?.details || data?.field_errors || data?.errors;
  const canonical = explicitFields !== null && typeof explicitFields === 'object';
  const root = canonical ? explicitFields : data;
  const result = {};
  const visit = (value, path) => {
    if (typeof value === 'string' && path) { result[path] = safeDisplayText(value, 'Maydonni tekshiring.'); return; }
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      if (path && value.length) result[path] = safeDisplayText(value.join(' '), 'Maydonni tekshiring.');
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (nonFieldKeys.has(key) || privateMetadata.test(key)) continue;
      // Envelope metadata is only metadata at the response root. Business
      // fields named code/message (including nested variant codes) are valid.
      if (!canonical && !path && envelopeKeys.has(key) && !Array.isArray(child)) continue;
      visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit(root, '');
  return result;
}

function keys(field) {
  return [field.dataset.apiField, field.name, field.id].flatMap(value => String(value || '').split(/\s+/)).filter(Boolean).map(normalize);
}

function displayControl(field) {
  return field.ownerDocument.getElementById(field.dataset.validationTarget) || field;
}

function valueOf(field) {
  return field.type === 'checkbox' || field.type === 'radio' ? String(field.checked) : field.value;
}

export function clearFieldError(field) {
  const target = displayControl(field), record = messages.get(target);
  if (!record) return;
  record.node.remove();
  const descriptions = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== record.id);
  if (descriptions.length) target.setAttribute('aria-describedby', descriptions.join(' '));
  else target.removeAttribute('aria-describedby');
  if (record.originalInvalid === null) target.removeAttribute('aria-invalid');
  else target.setAttribute('aria-invalid', record.originalInvalid);
  delete target.dataset.validationInvalid;
  messages.delete(target);
}

export function markFieldError(field, message) {
  const target = displayControl(field);
  clearFieldError(field);
  if (!message || !target.isConnected) return;
  const node = target.ownerDocument.createElement('div');
  const id = `ilbi-field-error-${++sequence}`;
  let text = String(message);
  // Even a malformed validation response must not echo the entered password.
  if ((field.type === 'password' || keys(field).some(key => key.includes('password'))) && field.value) text = text.split(field.value).join('[yashirilgan]');
  node.id = id; node.className = 'field-error'; node.setAttribute('role', 'alert'); node.textContent = safeDisplayText(text, 'Maydonni tekshiring.');
  const parent = target.parentElement;
  // Keep currency suffixes/password-eye icons inside their original control.
  const anchor = target.closest('[data-validation-container]') || (parent?.style.position === 'relative' && parent.querySelectorAll(controls).length === 1 ? parent : target);
  anchor.insertAdjacentElement('afterend', node);
  messages.set(target, { node, id, originalInvalid: target.getAttribute('aria-invalid') });
  target.dataset.validationInvalid = 'true';
  target.setAttribute('aria-invalid', 'true');
  target.setAttribute('aria-describedby', [target.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
}

export function fieldChanged(field) {
  revisions.set(field, (revisions.get(field) || 0) + 1);
  clearFieldError(field);
}


function nativeMessage(field) {
  const validity = field.validity;
  if (validity.valueMissing) return 'Bu maydonni to‘ldiring.';
  if (validity.typeMismatch) return field.type === 'email' ? 'Email manzilini to‘g‘ri kiriting.' : 'Qiymat formatini tekshiring.';
  if (validity.tooShort) return `Kamida ${field.minLength} ta belgi kiriting.`;
  if (validity.tooLong) return `Ko‘pi bilan ${field.maxLength} ta belgi kiriting.`;
  if (validity.rangeUnderflow) return `Qiymat ${field.min} dan kam bo‘lmasligi kerak.`;
  if (validity.rangeOverflow) return `Qiymat ${field.max} dan oshmasligi kerak.`;
  if (validity.patternMismatch) return field.title || 'Maydon formatini tekshiring.';
  if (validity.badInput || validity.stepMismatch) return 'Qiymatni to‘g‘ri kiriting.';
  return field.validationMessage || 'Maydonni tekshiring.';
}

export function refreshFieldValidation(field) {
  if (!field || (!messages.has(displayControl(field)) && !touched.has(field))) return;
  if (field.willValidate && !field.validity.valid) markFieldError(field, nativeMessage(field));
  else clearFieldError(field);
}

function matchingFields(form, key) {
  const available = [...form.querySelectorAll(controls)].filter(field => field.type !== 'hidden' || field.dataset.validationTarget);
  const normalized = normalize(key);
  const exact = available.filter(field => keys(field).includes(normalized));
  if (exact.length) return exact;
  // A nested serializer's leaf is usable only when it is unambiguous.
  const leaf = normalized.split('.').at(-1);
  const leaves = available.filter(field => keys(field).includes(leaf));
  return leaves.length === 1 ? leaves : [];
}

export function showFormErrors(form, errors) {
  if (!form?.isConnected) return;
  let first;
  for (const [key, message] of Object.entries(errors)) {
    const fields = matchingFields(form, key);
    if (fields.length !== 1) continue;
    markFieldError(fields[0], message);
    first ||= displayControl(fields[0]);
  }
  first?.focus({ preventScroll: true });
  first?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

export function captureRequestValidation(method, body) {
  if (typeof document === 'undefined' || !['POST', 'PUT', 'PATCH'].includes(String(method || 'GET').toUpperCase())) return null;
  let entries;
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    entries = typeof FormData !== 'undefined' && data instanceof FormData ? [...data.entries()] : Object.entries(data || {});
  } catch { return null; }
  const eligible = [];
  for (const [form, submission] of submissions) {
    if (!form.isConnected || Date.now() - submission.time > 30000) { submissions.delete(form); continue; }
    const related = entries.flatMap(([name, value]) => {
      if (value !== null && typeof value === 'object') return [];
      const fields = matchingFields(form, name);
      return fields.length === 1 ? [{ field: fields[0], value }] : [];
    });
    const comparable = value => {
      const string = String(value ?? '').trim().replace(/(?<=\d)\s+(?=\d)/g, '');
      if (!/^-?\d+(?:\.\d+)?$/.test(string)) return string;
      const [whole, fraction = ''] = string.split('.');
      const integer = whole.replace(/^(-?)0+(?=\d)/, '$1'), decimals = fraction.replace(/0+$/, '');
      return integer + (decimals ? '.' + decimals : '');
    };
    const matched = related.filter(({ field, value }) => comparable(valueOf(field)) === comparable(value));
    if (matched.length) eligible.push({ form, submission, matched });
  }
  const focused = document.activeElement?.closest('form');
  const selected = eligible.find(record => record.form === activeSubmission) || eligible.find(record => record.form === focused);
  if (!selected) return null;
  return { ...selected, fields: selected.matched.map(({ field }) => ({ field, value: valueOf(field), revision: revisions.get(field) || 0 })) };
}

export function reportRequestValidation(error, context) {
  if (![400, 422].includes(error?.status) || !context || !context.form.isConnected || !context.form.getClientRects().length || submissions.get(context.form) !== context.submission) return;
  const errors = validationFields(error.data);
  const current = {};
  for (const [key, message] of Object.entries(errors)) {
    const fields = matchingFields(context.form, key);
    if (fields.length !== 1) continue;
    const snapshot = context.fields.find(record => record.field === fields[0]);
    if (snapshot && snapshot.value === valueOf(snapshot.field) && snapshot.revision === (revisions.get(snapshot.field) || 0)) current[key] = message;
  }
  showFormErrors(context.form, current);
}

export function installFormValidation(root = document) {
  let focusQueued = false;
  let invalidScope = null;
  const invalid = event => {
    const field = event.target;
    if (!field.matches?.(controls)) return;
    event.preventDefault();
    touched.add(field);
    markFieldError(field, nativeMessage(field));
    if (!focusQueued) {
      focusQueued = true;
      invalidScope = field.form || field.parentElement;
      queueMicrotask(() => {
        focusQueued = false;
        const first = invalidScope?.querySelector('[data-validation-invalid="true"]');
        first?.focus({ preventScroll: true });
        first?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      });
    }
  };
  const changed = event => {
    const field = event.target;
    if (!field.matches?.(controls)) return;
    const hadError = messages.has(displayControl(field));
    fieldChanged(field);
    if ((hadError || touched.has(field)) && field.willValidate && !field.validity.valid) markFieldError(field, nativeMessage(field));
  };
  const blurred = event => {
    const field = event.target;
    if (field.matches?.(controls)) {
      touched.add(field);
      if (field.willValidate && !field.validity.valid) markFieldError(field, nativeMessage(field));
    }
  };
  const submitted = event => {
    const form = event.target;
    if (form.tagName !== 'FORM') return;
    const blank = [...form.querySelectorAll(controls)].filter(field => field.required && !field.disabled && !field.readOnly && ['text', 'search', 'email', 'tel', 'url', 'textarea'].includes(field.type) && !field.value.trim());
    if (blank.length) {
      event.preventDefault(); event.stopPropagation();
      for (const field of blank) { touched.add(field); markFieldError(field, 'Bu maydonni to‘ldiring.'); }
      displayControl(blank[0]).focus();
      return;
    }
    for (const field of form.querySelectorAll(controls)) clearFieldError(field);
    submissions.set(form, { id: ++sequence, time: Date.now() });
    activeSubmission = form;
    queueMicrotask(() => { if (activeSubmission === form) activeSubmission = null; });
  };
  const reset = () => {
    for (const field of root.querySelectorAll(controls)) clearFieldError(field);
    submissions.clear(); activeSubmission = null;
  };
  root.addEventListener('invalid', invalid, true);
  root.addEventListener('input', changed, true);
  root.addEventListener('change', changed, true);
  root.addEventListener('focusout', blurred, true);
  root.addEventListener('submit', submitted, true);
  const view = root.defaultView;
  view?.addEventListener('auth:logout', reset);
  view?.addEventListener('tenant_changed', reset);
  return () => {
    root.removeEventListener('invalid', invalid, true);
    root.removeEventListener('input', changed, true);
    root.removeEventListener('change', changed, true);
    root.removeEventListener('focusout', blurred, true);
    root.removeEventListener('submit', submitted, true);
    view?.removeEventListener('auth:logout', reset);
    view?.removeEventListener('tenant_changed', reset);
    reset();
  };
}
