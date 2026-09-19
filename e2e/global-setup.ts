import { seedFixture } from './helpers/schedule';

/** Most specs assert against the fixture month, so build it first. */
export default async function globalSetup() {
  await seedFixture();
}
