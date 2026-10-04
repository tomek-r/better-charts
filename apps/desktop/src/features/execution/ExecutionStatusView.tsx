import { useExecutionPortfolio } from './ExecutionProvider';

export function ExecutionStatusView() {
  const { closeCancelStatus } = useExecutionPortfolio();
  if (closeCancelStatus?.source !== 'draft') {
    return null;
  }
  return (
    <section className="risk-card" aria-labelledby="risk-title">
      <p className={`command-status ${closeCancelStatus.kind}`} role="status">
        {closeCancelStatus.text}
      </p>
    </section>
  );
}
