import type { ReactNode } from 'react';

/** A labelled text input row of the settings dialog; `children` follow the input (e.g. a detection hint). */
export function SettingsTextField({
  label,
  value,
  onChange,
  type,
  autoComplete,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  autoComplete?: 'off';
  children?: ReactNode;
}) {
  return (
    <label className="settings-field">
      {label}
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {children}
    </label>
  );
}
