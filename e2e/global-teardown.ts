import { restoreSample } from './helpers/schedule';

/**
 * Leave the database as the live site serves it: the imported sample in place.
 * The suite swaps in its own fixture, so it has to put this back.
 */
export default async function globalTeardown() {
  await restoreSample();
}
