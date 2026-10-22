import type { Mt5InstallationView } from '../../../../shared/bridge/types';

/** Whether any data folder of any installation already holds the bridge EA's source. */
export function anyDataFolderHoldsTheExpertAdvisor(installations: Mt5InstallationView[]): boolean {
  return installations.some((installation) =>
    installation.dataFolders.some((dataFolder) => dataFolder.expertAdvisorInstalled),
  );
}
