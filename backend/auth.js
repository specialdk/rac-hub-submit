// Users tab column layout (see project memory: Users tab schema)
// A=Username  B=FullName  C=Department  D=Role  E=AccessLevel  F=Active
// G..K unused for auth
// L=PIN  M=Email
export const USERS_RANGE = 'Users!A:M';

const NAME_IDX = 1;    // B
const ROLE_IDX = 4;    // E (auth role: Admin or User)
const ACTIVE_IDX = 5;  // F (string "TRUE" / "FALSE")
const PIN_IDX = 11;    // L
const EMAIL_IDX = 12;  // M

// Pure function: given the rows of the Users tab (including header at index 0)
// and a submitted PIN, return the auth result.
//
// Sheets API returns values as strings, including booleans ("TRUE"/"FALSE"),
// so all comparisons are string-based. Active is treated case-insensitively
// to be forgiving if a manual edit lowercases it.
export function findUserByPin(rows, pin) {
  if (!Array.isArray(rows)) {
    return { ok: false, error: 'INVALID_PIN' };
  }
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowPin = (row[PIN_IDX] ?? '').toString().trim();
    if (rowPin === pin) {
      const active = (row[ACTIVE_IDX] ?? '').toString().trim().toUpperCase();
      if (active !== 'TRUE') {
        return { ok: false, error: 'INACTIVE_USER' };
      }
      return {
        ok: true,
        name: (row[NAME_IDX] ?? '').toString().trim(),
        email: (row[EMAIL_IDX] ?? '').toString().trim(),
        role: (row[ROLE_IDX] ?? '').toString().trim(),
      };
    }
  }
  return { ok: false, error: 'INVALID_PIN' };
}
