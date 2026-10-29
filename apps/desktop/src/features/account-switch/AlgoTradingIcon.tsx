/** Check mark when algo trading is on, warning triangle when it is off; colour from `currentColor`. */
export function AlgoTradingIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      data-algo-icon={enabled ? 'check' : 'warning'}
    >
      {enabled ? (
        <>
          <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="m7.75 12.25 2.75 2.75 5.75-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <path
            d="M12 3.25 21.5 20H2.5L12 3.25Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M12 9.5v4.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="12" cy="17.25" r="1.1" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
