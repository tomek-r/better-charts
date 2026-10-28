import type { Mt5FileReport, Mt5InstallReport } from '../../../../../shared/bridge/types';
import { compileText, FILE_NAMES, OUTCOME_WORDS } from './installText';

/** One report entry: the file, what happened to it, and what MetaEditor said about it. */
function FileResultRow({ file }: { file: Mt5FileReport }) {
  return (
    <li className="setup-guide-install-file">
      <span className="setup-guide-install-file-name">{FILE_NAMES[file.file]}</span>
      <span className="setup-guide-install-file-outcome">{OUTCOME_WORDS[file.outcome]}</span>
      <span className="setup-guide-install-file-compile">{compileText(file.compiled)}</span>
      {file.compiled && file.compiled.messages.length > 0 && (
        <ul className="setup-guide-install-messages">
          {file.compiled.messages.map((message, index) => (
            <li key={`${file.file}-${index}`}>{message}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One row per file, shown only when a diagnostic or an uncompiled file needs attention. */
export function InstallResults({ report }: { report: Mt5InstallReport }) {
  return (
    <div className="setup-guide-install-results">
      <ul className="setup-guide-install-files">
        {report.files.map((file) => (
          <FileResultRow key={file.file} file={file} />
        ))}
      </ul>
    </div>
  );
}
