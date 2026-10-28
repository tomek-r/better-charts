/** Inline error line of the guide: the same red note wherever a command refused. */
export function GuideError({ message }: { message: string }) {
  return (
    <p className="setup-guide-install-error" role="alert">
      {message}
    </p>
  );
}
