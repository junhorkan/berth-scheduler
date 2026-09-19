import { clearSchedule } from './helpers/schedule';

/** Leave the database as the app ships: an empty schedule with the berths intact. */
export default async function globalTeardown() {
  await clearSchedule();
}
