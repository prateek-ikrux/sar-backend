# sar-backend

## Tests

```bash
npm test
```

Uses Node's built-in test runner; files live in `test/`. `test/auth.test.js` starts a
throwaway MongoDB through `mongodb-memory-server`, so the first run downloads a MongoDB binary
(about 800 MB, cached in `~/.cache/mongodb-binaries`). No test talks to Atlas, MinIO,
Microsoft Graph or OpenAI.

## Rolling out passwords

Sign-in requires a password, but existing users have none, and none is ever handed out.
Everyone sets their own the first time through **Forgot password** on the sign-in page: it
emails a code to their ikrux address, they enter it with the password they choose, then
sign in with that password and a fresh code. New users get a welcome email telling them to
do the same. There is no script and no data migration.

1. **Deploy the frontend and the backend together.** Request schemas are strict, so an old
   frontend against the new backend (or the reverse) gets 422s.
2. **Tell staff** that from now on they sign in with a password plus the emailed code, and
   that the first time they should choose "Forgot password?" to set one. The sign-in page
   says this too.

Until someone sets a password, signing in with any password answers "Incorrect email or
password", the same as a wrong one, so the sign-in page doesn't reveal who has set one.

## Cleaning up handed-out passwords

An earlier version gave users a starting or generated password and a
`must_change_password` flag forcing them to replace it. Both are gone, but a database that
ran that version still holds them, and without the forced change a handed-out password
would simply work. `scripts/cleanup-handed-out-passwords.js` fixes that, once.

- **Users with `must_change_password: true`** (still on a password they didn't choose):
  `password_hash` and `must_change_password` are removed, and `password_changed_at` is set
  to now, which ends their existing sessions. They set their own password with "Forgot
  password".
- **Users with `must_change_password: false`** (chose their own): only the flag is removed.
  Their password is kept.
- **Everyone else** is untouched.

Run it from a repo checkout (`npm ci` in `sar-backend`; the production image only contains
`src/`), with `MONGODB_URI` and `SEARCH_AND_RETRIEVAL_DB_NAME` pointing at the database to
fix:

```bash
npm run cleanup-handed-out-passwords              # dry run: lists who would be affected
npm run cleanup-handed-out-passwords -- --apply   # makes the changes
```

**This can't be undone:** removed hashes are gone. Only passwords nobody chose are removed,
and "Forgot password" replaces them. Running it again finds nothing to do.
