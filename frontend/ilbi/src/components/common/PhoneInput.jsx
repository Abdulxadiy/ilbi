import React, { useRef, useLayoutEffect, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { formatPhoneUz, cleanPhoneUz, extractNationalDigits, isValidPhoneUz } from '../../utils/phoneFormat';
import { refreshFieldValidation } from '../../utils/formValidation.js';

/**
 * PhoneInput Component for Uzbekistan (+998 XX XXX XX XX)
 *
 * Enforces +998 prefix and displays spaced format "+998 90 123 45 67",
 * while providing canonical "+998901234567" to form handlers and APIs!
 */
const PhoneInput = forwardRef(function PhoneInput({
  value = '',
  onChange,
  onBlur,
  onFocus,
  placeholder = '+998 90 123 45 67',
  className = 'input-field',
  style = {},
  disabled = false,
  required = false,
  name = '',
  id = '',
  autoFocus = false,
  ...rest
}, ref) {
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => inputRef.current);
  const [displayValue, setDisplayValue] = useState(() => formatPhoneUz(value));
  const cursorRef = useRef(null);

  // Sync display value when incoming value prop changes from parent
  useEffect(() => {
    const formatted = formatPhoneUz(value);
    setDisplayValue(formatted);
  }, [value]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(value && !isValidPhoneUz(value) ? 'Telefon raqamini to‘liq kiriting: +998 va 9 ta raqam.' : '');
    refreshFieldValidation(inputRef.current);
  }, [value]);

  // Restore cursor position after formatting state update
  useLayoutEffect(() => {
    if (cursorRef.current !== null && inputRef.current) {
      const pos = cursorRef.current;
      inputRef.current.setSelectionRange(pos, pos);
      cursorRef.current = null;
    }
  }, [displayValue]);

  const triggerChange = (cleanVal, formattedVal, rawEvent) => {
    if (typeof onChange === 'function') {
      const isValid = isValidPhoneUz(cleanVal);
      const syntheticEvent = {
        ...(rawEvent || {}),
        target: {
          ...(rawEvent?.target || {}),
          name,
          id,
          value: cleanVal, // canonical "+998901234567"
          formattedValue: formattedVal, // spaced "+998 90 123 45 67"
          isValid,
        },
        currentTarget: {
          ...(rawEvent?.currentTarget || {}),
          name,
          id,
          value: cleanVal,
        },
        toString: () => cleanVal,
        valueOf: () => cleanVal,
      };
      onChange(syntheticEvent, cleanVal, formattedVal);
    }
  };

  const handleChange = (e) => {
    const input = e.target;
    const rawInput = input.value;
    const cursorPos = input.selectionStart || 0;

    // Count national digits before cursor in raw input
    // Digits inside "+998" (first 4 chars) are prefix, not national digits
    let nationalDigitsBeforeCursor = 0;
    const prefixOffset = rawInput.startsWith('+998') ? 4 : 0;
    if (cursorPos > prefixOffset) {
      const textAfterPrefix = rawInput.slice(prefixOffset, cursorPos);
      nationalDigitsBeforeCursor = textAfterPrefix.replace(/\D/g, '').length;
    }

    const national = extractNationalDigits(rawInput);
    if (!national) {
      cursorRef.current = 0;
      setDisplayValue('');
      triggerChange('', '', e);
      return;
    }

    const formatted = formatPhoneUz(national);
    const clean = cleanPhoneUz(national);

    // Calculate new cursor position in formatted string "+998 XX XXX XX XX"
    let newCursor = 5; // default position right after "+998 "
    let count = 0;
    for (let i = 5; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) {
        count++;
        if (count === nationalDigitsBeforeCursor) {
          newCursor = i + 1;
          break;
        }
      }
    }
    if (count < nationalDigitsBeforeCursor) {
      newCursor = formatted.length;
    }

    cursorRef.current = newCursor;
    setDisplayValue(formatted);
    triggerChange(clean, formatted, e);
  };

  const handleKeyDown = (e) => {
    const input = inputRef.current;
    if (!input) return;

    if (e.key === 'Backspace') {
      const { selectionStart, selectionEnd } = input;
      // If cursor is at or before "+998 ", don't allow deleting prefix
      if (selectionStart <= 5 && selectionEnd <= 5 && selectionStart === selectionEnd) {
        e.preventDefault();
        return;
      }

      // If cursor is immediately after a space, delete the digit before the space
      if (selectionStart === selectionEnd && selectionStart > 5) {
        if (input.value[selectionStart - 1] === ' ') {
          e.preventDefault();
          const before = input.value.slice(0, selectionStart - 2);
          const after = input.value.slice(selectionStart);
          const rawJoined = before + after;
          const national = extractNationalDigits(rawJoined);
          const formatted = formatPhoneUz(national);
          const clean = cleanPhoneUz(national);

          cursorRef.current = Math.max(5, selectionStart - 2);
          setDisplayValue(formatted);
          triggerChange(clean, formatted, e);
        }
      }
    }
  };

  const handleFocus = (e) => {
    if (!displayValue) {
      setDisplayValue('+998 ');
      cursorRef.current = 5;
    }
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e) => {
    if (displayValue === '+998 ' || displayValue === '+998') {
      setDisplayValue('');
      triggerChange('', '', e);
    }
    if (onBlur) onBlur(e);
  };

  return (
    <input
      ref={inputRef}
      type="tel"
      inputMode="tel"
      name={name}
      id={id}
      value={displayValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      required={required}
      autoFocus={autoFocus}
      maxLength={17}
      style={style}
      {...rest}
    />
  );
});

export default PhoneInput;
