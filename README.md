# sar-backend

## Tests

```bash
npm test
```

Uses Node's built-in test runner; files live in `test/`. `test/auth.test.js` starts a
throwaway MongoDB through `mongodb-memory-server`, so the first run downloads a MongoDB binary
(about 800 MB, cached in `~/.cache/mongodb-binaries`). No test talks to Atlas, MinIO,
Microsoft Graph or OpenAI.
