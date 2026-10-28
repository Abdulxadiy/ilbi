import React, { useRef, useLayoutEffect, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { formatThousands, cleanNumber } from '../../utils/numberFormat';
import { refreshFieldValidation } from '../../utils/formValidation.js';

/**
 * PriceInput Component
 *
 * Automatically formats numeric input with thousands-separating spaces (e.g. "120 000", "1 200 000.50"),
 * while providing clean unspaced numbers ("120000") to form handlers and APIs!
 */
const PriceInput = forwardRef(function PriceInput({
  value = '',
  onChange,
  onBlur,
  onFocus,
  placeholder = '0',
  className = 'input-field',
  style = {},
  disabled = false,
  required = false,
  name = '',
  id = '',
  autoFocus = false,
  min,
  max,
  cur = '',
  ...rest
}, ref) {
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => inputRef.current);
  const [displayValue, setDisplayValue] = useState(() => formatThousands(value));
  const cursorRef = useRef(null);

  // Sync display value when incoming value prop changes from parent
  useEffect(() => {
    const formatted = formatThousands(value);
    setDisplayValue(formatted);
  }, [value]);

  useEffect(() => {
    const clean = cleanNumber(displayValue);
    const number = Number(clean);
    const invalid = clean !== '' && (!Number.isFinite(number) || (min !== undefined && number < Number(min)) || (max !== undefined && number > Number(max)));
    inputRef.current?.setCustomValidity(invalid ? `Qiymat ${min ?? 0} dan ${max ?? 'yuqori chegarasiz'} gacha bo‘lishi kerak.` : '');
    refreshFieldValidation(inputRef.current);
  }, [displayValue, min, max]);

  // Restore cursor position after formatting state update
  useLayoutEffect(() => {
    if (cursorRef.current !== null && inputRef.current) {
      const pos = cursorRef.current;
      inputRef.current.setSelectionRange(pos, pos);
      cursorRef.current = null;
    }
  }, [displayValue]);

  const triggerChange = (cleanVal, rawEvent) => {
    if (typeof onChange === 'function') {
      const syntheticEvent = {
        ...(rawEvent || {}),
        target: {
          ...(rawEvent?.target || {}),
          name,
          id,
          value: cleanVal,
          rawValue: cleanVal !== '' ? Number(cleanVal) : '',
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
      onChange(syntheticEvent, cleanVal);
    }
  };

  const handleChange = (e) => {
    const input = e.target;
    const rawInput = input.value;
    const cursorPos = input.selectionStart || 0;

    // Count meaningful digits/dots before cursor before reformatting
    const textBeforeCursor = rawInput.slice(0, cursorPos);
    const charsBeforeCursor = textBeforeCursor.replace(/[^\d.]/g, '').length;

    const clean = cleanNumber(rawInput);
    const formatted = formatThousands(clean);

    // Calculate new cursor position in the formatted string
    let newCursor = 0;
    let charCount = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (/[\d.]/.test(formatted[i])) {
        charCount++;
      }
      if (charCount === charsBeforeCursor) {
        newCursor = i + 1;
        break;
      }
    }
    if (charCount < charsBeforeCursor) {
      newCursor = formatted.length;
    }

    cursorRef.current = newCursor;
    setDisplayValue(formatted);
    triggerChange(clean, e);
  };

  const handleKeyDown = (e) => {
    const input = inputRef.current;
    if (!input) return;

    // Smart Backspace: If cursor is immediately after a space, delete the digit before the space
    if (e.key === 'Backspace') {
      const { selectionStart, selectionEnd } = input;
      if (selectionStart === selectionEnd && selectionStart > 0) {
        if (input.value[selectionStart - 1] === ' ') {
          e.preventDefault();
          const before = input.value.slice(0, selectionStart - 2);
          const after = input.value.slice(selectionStart);
          const rawJoined = before + after;
          const clean = cleanNumber(rawJoined);
          const formatted = formatThousands(clean);

          cursorRef.current = Math.max(0, selectionStart - 2);
          setDisplayValue(formatted);
          triggerChange(clean, e);
        }
      }
    }
  };

  const formattedPlaceholder = placeholder ? formatThousands(placeholder) : '0';

  if (cur) {
    return (
      <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          name={name}
          id={id}
          value={displayValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          onFocus={onFocus}
          placeholder={formattedPlaceholder}
          className={className}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          style={{ paddingRight: cur ? 48 : undefined, ...style }}
          {...rest}
        />
        <span
          style={{
            position: 'absolute',
            right: 12,
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text-muted)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {cur}
        </span>
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      name={name}
      id={id}
      value={displayValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={onBlur}
      onFocus={onFocus}
      placeholder={formattedPlaceholder}
      className={className}
      disabled={disabled}
      required={required}
      autoFocus={autoFocus}
      style={style}
      {...rest}
    />
  );
});

export default PriceInput;
