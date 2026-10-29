import { Fragment, type ReactNode } from 'react';

import './separator-icon.css';

export function SeparatorIcon() {
  return (
    <svg className="separator-icon" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <path d="M4 0.5 L7.5 4 L4 7.5 L0.5 4 Z" />
    </svg>
  );
}

export function Separated({ parts }: { parts: ReactNode[] }) {
  const visibleParts = parts.filter((part) => part !== null && part !== undefined && part !== '' && part !== false);

  return (
    <>
      {visibleParts.map((part, index) => (
        <Fragment key={index}>
          {/* Real spaces around the icon keep the words apart in the text that is read and copied. */}
          {index > 0 ? (
            <>
              {' '}
              <SeparatorIcon />{' '}
            </>
          ) : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}
