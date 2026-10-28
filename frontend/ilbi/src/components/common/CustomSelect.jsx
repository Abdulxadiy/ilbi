import IlbiLoader from './IlbiLoader';
import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, X } from 'lucide-react';
import { useSelectPopover } from '../../hooks/useSelectPopover';
import { fieldChanged } from '../../utils/formValidation.js';

const normalizeSearch = value => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('uz')
  .replace(/['‘’ʻʼ`´]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const renderIconNode = (IconNode, size) => {
  if (!IconNode) return null;
  if (React.isValidElement(IconNode)) return IconNode;
  if (
    typeof IconNode === 'function' ||
    (typeof IconNode === 'object' && IconNode !== null && (IconNode.$$typeof || typeof IconNode.render === 'function'))
  ) {
    return React.createElement(IconNode, { size });
  }
  if (typeof IconNode === 'string' || typeof IconNode === 'number') {
    return IconNode;
  }
  return null;
};

/**
 * Universal Glassmorphic CustomSelect Component
 * Replaces native browser <select> with a sleek, accessible, theme-integrated dropdown.
 */
export default function CustomSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Tanlang...',
  icon: Icon = null,
  disabled = false,
  required = false,
  'data-api-field': apiField,
  className = '',
  style = {},
  menuStyle = {},
  size = 'md', // 'sm' | 'md' | 'lg'
  name = '',
  id = '',
  fullWidth = false,
  title = '',
  'aria-label': ariaLabel,
  searchable = true,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Qidirish...',
  searchLoading = false,
  footer = null,
  clearable = false,
  onClear = null,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState('');
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const nativeRef = useRef(null);
  const validationId = useId();
  useEffect(() => { if (nativeRef.current) fieldChanged(nativeRef.current); }, [value]);
  const popover = useSelectPopover({
    isOpen, anchorRef: triggerRef, menuRef, onClose: () => setIsOpen(false),
    searchable, hasFooter: Boolean(footer), menuStyle,
  });
  const renderMenu = menu => popover.supported ? menu
    : createPortal(menu, popover.portalRoot || document.body);

  // When menu opens, autofocus the search input if searchable
  useEffect(() => {
    if (isOpen && searchable) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus({ preventScroll: true });
      }, 50);
      return () => clearTimeout(timer);
    }
    if (!isOpen && !onSearchChange) {
      setInternalSearch('');
    }
  }, [isOpen, searchable, onSearchChange]);

  // Normalize options to [{ value, label, icon, badge, disabled }]
  const normalizedOptions = options.map((opt) => {
    if (typeof opt === 'object' && opt !== null) {
      return {
        value: opt.value ?? '',
        label: opt.label ?? opt.name ?? String(opt.value ?? ''),
        icon: opt.icon ?? null,
        badge: opt.badge ?? null,
        disabled: Boolean(opt.disabled),
        color: opt.color ?? null,
      };
    }
    return {
      value: opt,
      label: String(opt),
      icon: null,
      badge: null,
      disabled: false,
      color: null,
    };
  });

  const selectedOption = normalizedOptions.find(
    (opt) => String(opt.value) === String(value)
  );

  const isControlledSearch = searchValue !== undefined;
  const currentQuery = normalizeSearch(isControlledSearch ? searchValue : internalSearch);

  // If controlled (remote), options are filtered by server. If uncontrolled and searchable, filter locally.
  const displayedOptions = useMemo(() => {
    if (!searchable || isControlledSearch || !currentQuery) {
      return normalizedOptions;
    }
    return normalizedOptions.filter((opt) =>
      normalizeSearch(opt.label).includes(currentQuery)
    );
  }, [normalizedOptions, searchable, isControlledSearch, currentQuery]);

  useEffect(() => {
    menuRef.current?.querySelector('.custom-select-options')?.scrollTo({ top: 0 });
  }, [currentQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Elevate parent stacking context when open so dropdown menu floats above sibling cards/tables
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const parent = containerRef.current.closest('.glass-card, .table-responsive, [class*="card"]');
    if (!parent) return;

    const originalZIndex = parent.style.zIndex;
    const originalPos = parent.style.position;
    parent.style.zIndex = '60';
    if (!originalPos || originalPos === 'static') {
      parent.style.position = 'relative';
    }

    return () => {
      parent.style.zIndex = originalZIndex;
      parent.style.position = originalPos;
    };
  }, [isOpen]);

  const handleSelect = (opt) => {
    if (opt.disabled || disabled) return;
    setIsOpen(false);

    if (typeof onChange === 'function') {
      const syntheticEvent = {
        target: { name, value: opt.value },
        currentTarget: { name, value: opt.value },
        preventDefault: () => {},
        stopPropagation: () => {},
      };

      try {
        // First try standard callback with direct value and synthetic event as second arg
        onChange(opt.value, syntheticEvent);
      } catch {
        // If caller expected (e) => e.target.value and crashed on primitive value:
        try {
          onChange(syntheticEvent);
        } catch {}
      }
    }
  };

  // Size variations
  const sizeStyles = {
    sm: {
      padding: '5px 9px',
      fontSize: 12,
      minHeight: 30,
      iconSize: 13,
      gap: 5,
    },
    md: {
      padding: '8px 12px',
      fontSize: 13,
      minHeight: 38,
      iconSize: 14,
      gap: 7,
    },
    lg: {
      padding: '11px 14px',
      fontSize: 14,
      minHeight: 44,
      iconSize: 16,
      gap: 8,
    },
  }[size] || {
    padding: '8px 12px',
    fontSize: 13,
    minHeight: 38,
    iconSize: 14,
    gap: 7,
  };

  return (
    <div
      ref={containerRef}
      data-validation-container="true"
      id={id ? `${id}-container` : undefined}
      className={`custom-select-wrapper ${className}`}
      data-open={isOpen ? 'true' : 'false'}
      onKeyDown={(event) => {
        if (isOpen && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen(false);
        }
      }}
      style={{
        position: 'relative',
        display: fullWidth ? 'flex' : 'inline-flex',
        flexDirection: 'column',
        minWidth: 0,
        maxWidth: '100%',
        width: fullWidth ? '100%' : 'auto',
        userSelect: 'none',
        zIndex: isOpen ? 100 : undefined,
      }}
      title={title}
    >
      {/* Hidden input for form serialization */}
      {name && <input type="hidden" name={name} value={value ?? ''} id={id} />}

      {/* Hidden native select for form serialization and automated test compatibility */}
      <select
        ref={nativeRef}
        required={required}
        data-api-field={apiField}
        data-validation-target={validationId}
        aria-hidden="true"
        tabIndex={-1}
        name={name ? `${name}_select` : undefined}
        id={id ? `${id}_select` : undefined}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const matchingOpt = normalizedOptions.find((opt) => String(opt.value) === String(e.target.value));
          handleSelect(matchingOpt || { value: e.target.value });
        }}
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: 1,
          height: 1,
          margin: -1,
          border: 0,
          padding: 0,
          clip: 'rect(0 0 0 0)',
        }}
      >
        {!normalizedOptions.some(opt => String(opt.value) === '') && <option value="">{placeholder}</option>}
        {normalizedOptions.map((opt) => (
          <option key={String(opt.value)} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Main Trigger */}
      <div
        ref={triggerRef}
        id={validationId}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={selectedOption ? String(selectedOption.label) : placeholder}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: sizeStyles.gap,
          width: fullWidth ? '100%' : 'auto',
          minWidth: 0,
          maxWidth: '100%',
          boxSizing: 'border-box',
          minHeight: sizeStyles.minHeight,
          padding: sizeStyles.padding,
          fontSize: sizeStyles.fontSize,
          fontWeight: 600,
          borderRadius: 'var(--radius-sm, 10px)',
          border: isOpen ? '1px solid var(--primary)' : '1px solid var(--border-card)',
          background: 'var(--bg-input, rgba(255, 255, 255, 0.04))',
          color: selectedOption ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          boxShadow: isOpen ? '0 0 0 2px rgba(var(--primary-rgb), 0.2)' : 'none',
          transition: 'all 0.15s ease',
          opacity: disabled ? 0.6 : 1,
          textAlign: 'left',
          whiteSpace: 'nowrap',
          ...style,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: sizeStyles.gap, overflow: 'hidden', minWidth: 0, textOverflow: 'ellipsis' }}>
          {(selectedOption?.icon || Icon) && (
            <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--primary)', flexShrink: 0 }}>
              {renderIconNode(selectedOption?.icon || Icon, sizeStyles.iconSize)}
            </span>
          )}

          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>

          {selectedOption?.badge && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'rgba(var(--primary-rgb), 0.15)',
                color: 'var(--primary)',
                marginLeft: 2,
              }}
            >
              {selectedOption.badge}
            </span>
          )}
        </div>

        {clearable && Boolean(value) && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClear?.();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onClear?.();
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 2,
              borderRadius: '50%',
              marginRight: 2,
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent-rose)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
            title="Tanlovni tozalash"
          >
            <X size={sizeStyles.iconSize} />
          </span>
        )}

        <ChevronDown
          size={sizeStyles.iconSize}
          style={{
            color: 'var(--text-muted)',
            flexShrink: 0,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            marginLeft: 4,
          }}
        />
      </div>

      {/* Floating Glassmorphic Dropdown Menu */}
      {isOpen && renderMenu(
        <div
          ref={menuRef}
          popover={popover.supported ? 'manual' : undefined}
          className="custom-select-menu"
          role="listbox"
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{
            overflow: 'hidden',
            background: 'var(--bg-modal, var(--bg-card))',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--border-modal, var(--border-card))',
            borderRadius: 'var(--radius-sm, 10px)',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45), 0 4px 14px rgba(0, 0, 0, 0.2)',
            zIndex: 9999,
            padding: 5,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            boxSizing: 'border-box',
            ...menuStyle,
            ...popover.style,
          }}
        >
          {searchable && (
            <div
              style={{
                flexShrink: 0,
                zIndex: 10,
                padding: '4px 4px 6px 4px',
                background: 'var(--bg-modal, var(--bg-card))',
                borderBottom: '1px solid var(--border-subtle)',
                marginBottom: 4,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search
                  size={13}
                  style={{
                    position: 'absolute',
                    left: 9,
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  value={isControlledSearch ? (searchValue || '') : internalSearch}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
                  onChange={(e) => {
                    if (onSearchChange) onSearchChange(e.target.value);
                    else setInternalSearch(e.target.value);
                  }}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '7px 26px 7px 28px',
                    borderRadius: 'var(--radius-xs, 6px)',
                    border: '1px solid var(--border-card)',
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.05))',
                    color: 'var(--text-primary)',
                    fontSize: 12.5,
                    outline: 'none',
                  }}
                />
                {Boolean(isControlledSearch ? searchValue : internalSearch) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onSearchChange) onSearchChange('');
                      else setInternalSearch('');
                      searchInputRef.current?.focus();
                    }}
                    style={{
                      position: 'absolute',
                      right: 6,
                      background: 'none',
                      border: 'none',
                      padding: 2,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Qidiruvni tozalash"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="custom-select-options" style={{ overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', minHeight: 0, flex: '1 1 auto' }}>
          {searchLoading && (
            <div
              style={{
                padding: '10px 14px',
                fontSize: 12,
                color: 'var(--text-muted)',
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <IlbiLoader size={24} inline decorative />
              <span>Qidirilmoqda...</span>
            </div>
          )}

          {displayedOptions.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              {!searchLoading && 'Topilmadi'}
            </div>
          ) : (
            displayedOptions.map((opt) => {
              const isSelected = String(opt.value) === String(value);
              const OptIcon = opt.icon;

              return (
                <div
                  key={String(opt.value)}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-xs, 6px)',
                    fontSize: sizeStyles.fontSize,
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected
                      ? 'var(--primary)'
                      : opt.disabled
                      ? 'var(--text-muted)'
                      : 'var(--text-primary)',
                    background: isSelected
                      ? 'rgba(var(--primary-rgb), 0.12)'
                      : 'transparent',
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s ease, color 0.15s ease',
                    whiteSpace: 'normal',
                    lineHeight: 1.5,
                    opacity: opt.disabled ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !opt.disabled) {
                      e.currentTarget.style.background = 'var(--bg-app, rgba(255, 255, 255, 0.06))';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !opt.disabled) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, flex: 1, minWidth: 0 }}>
                    {OptIcon && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', color: isSelected ? 'var(--primary)' : 'var(--text-muted)' }}>
                        {renderIconNode(OptIcon, sizeStyles.iconSize)}
                      </span>
                    )}
                    <span style={{ minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'normal' }}>{opt.label}</span>
                    {opt.badge && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: isSelected ? 'rgba(var(--primary-rgb), 0.25)' : 'rgba(255, 255, 255, 0.08)',
                          color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                        }}
                      >
                        {opt.badge}
                      </span>
                    )}
                  </div>

                  {isSelected && (
                    <Check size={14} style={{ color: 'var(--primary)', flexShrink: 0, marginLeft: 8 }} />
                  )}
                </div>
              );
            })
          )}
          </div>

          {footer && (
            <div
              className="custom-select-footer"
              style={{
                flexShrink: 0,
                zIndex: 10,
                background: 'var(--bg-modal, var(--bg-card))',
                borderTop: '1px solid var(--border-subtle)',
                marginTop: 4,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
