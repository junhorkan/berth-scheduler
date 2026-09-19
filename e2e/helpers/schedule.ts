/**
 * The sample workbook is not loaded in the deployed app — it is an optional
 * demonstration. Most specs assert against it, so the suite loads it itself and
 * clears it again at the end, leaving the database in the state the app ships in.
 */
import postgres from 'postgres';

function sql() {
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
  return postgres(process.env.DATABASE_URL!, { prepare: false, ssl: 'require', max: 2 });
}

export async function loadSampleSchedule(): Promise<void> {
  const db = sql();
  try {
    await db.begin(async (tx) => {
      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;
      await tx`delete from berths`;
      await tx`insert into berths  select * from berths_seed`;
      await tx`insert into vessels select * from vessels_seed`;
      await tx`
        insert into bookings (
          id, berth_id, vessel_id, kind, status, label, start_date, end_date,
          exclusive, notes, source, import_year, import_sheet, import_row, import_col,
          created_at)
        select
          id, berth_id, vessel_id, kind, status, label, start_date, end_date,
          exclusive, notes, source, import_year, import_sheet, import_row, import_col,
          created_at
        from bookings_seed`;
      await tx`insert into review_items select * from review_items_seed`;
    });
  } finally {
    await db.end();
  }
}

/** Empties the schedule but keeps the berths — the facility itself is not sample data. */
export async function clearSchedule(): Promise<void> {
  const db = sql();
  try {
    await db.begin(async (tx) => {
      await tx`delete from review_items`;
      await tx`delete from bookings`;
      await tx`delete from vessels`;
    });
  } finally {
    await db.end();
  }
}
