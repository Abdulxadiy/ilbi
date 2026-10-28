import { useCallback, useState } from 'react';
import { fieldErrors, type FieldErrors } from '../api/validation';

export function useFormErrors() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const clear = useCallback((name?: string) => {
    setErrors(previous => {
      if (!name) return {};
      const next = { ...previous };
      Object.keys(next).forEach(key => { if (key === name || key.startsWith(name + '.')) delete next[key]; });
      return next;
    });
  }, []);
  const capture = useCallback((failure: unknown, fallback: FieldErrors = {}) => {
    const parsed = fieldErrors(failure);
    const next = Object.keys(parsed).length ? parsed : fallback;
    setErrors(next);
    return next;
  }, []);
  return { errors, setErrors, clear, capture };
}
