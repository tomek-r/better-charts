import { Loader } from './Loader';

/**
 * The app's loader: the volume profile's loading animation over a title and a hint, used wherever a workspace
 * waits for its data.
 */
export function LoadingMessage({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="loading-message">
      <Loader />
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}
