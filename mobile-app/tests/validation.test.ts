import { ApiError } from '../src/api/errors';
import { fieldErrors, formError } from '../src/api/validation';

describe('API field validation', () => {
  test('reads canonical backend fields instead of flattening them into a banner', () => {
    const failure = new ApiError('Invalid', 400, { error: { code: 'validation_error', details: { email: ['Email noto‘g‘ri.'], first_name: ['Ismni kiriting.'] } } });
    expect(fieldErrors(failure)).toEqual({ email: 'Email noto‘g‘ri.', first_name: 'Ismni kiriting.' });
  });
  test('preserves nested row paths and excludes form-wide messages', () => {
    expect(fieldErrors({ variants: [{ price_partner: ['Narx noto‘g‘ri.'] }, { name: ['Nom kerak.'] }], non_field_errors: ['General error'] })).toEqual({ 'variants.0.price_partner': 'Narx noto‘g‘ri.', 'variants.1.name': 'Nom kerak.' });
  });
  test('network, permission and plain exception messages do not mark arbitrary fields red', () => {
    expect(fieldErrors(new ApiError('Offline', 0, null, 0, 'NETWORK'))).toEqual({});
    expect(fieldErrors(new Error('Name is invalid'))).toEqual({});
    expect(fieldErrors({ error: { code: 'permission_denied', message: 'Denied', details: null } })).toEqual({});
  });
  test('local validation and plain DRF field dictionaries use the same contract', () => {
    expect(fieldErrors(formError({ name: 'Nomni kiriting.' }))).toEqual({ name: 'Nomni kiriting.' });
    expect(fieldErrors({ phone_number: ['Telefon noto‘g‘ri.'] })).toEqual({ phone_number: 'Telefon noto‘g‘ri.' });
  });
});
