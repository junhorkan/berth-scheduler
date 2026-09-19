import { loadSampleSchedule } from './helpers/schedule';

/** Most specs assert against the sample workbook, so put it in place first. */
export default async function globalSetup() {
  await loadSampleSchedule();
}
