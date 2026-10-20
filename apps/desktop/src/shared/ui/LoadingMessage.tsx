/** The app's loader: a turning glyph over a title and a hint, used wherever a workspace waits for its data. */
export function LoadingMessage({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="loading-message">
      <span className="overlay-glyph" aria-hidden="true">
        ◒
      </span>
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}
