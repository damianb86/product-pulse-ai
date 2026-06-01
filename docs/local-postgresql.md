# Local PostgreSQL

## Development Defaults
Use a simple local database for development:

```bash
createuser -s zuam_dev
createdb product_pulse_ai
```

Set:

```bash
DATABASE_URL=postgresql://zuam_dev:replace-with-local-password@127.0.0.1:5432/product_pulse_ai
```

If the local role has no password in Homebrew PostgreSQL, use the passwordless local URL only in your private `.env`:

```bash
DATABASE_URL=postgresql://zuam_dev@127.0.0.1:5432/product_pulse_ai
```

Do not commit real passwords.

## Migration
```bash
npm run setup
```

## Production Notes
- Use a managed Postgres instance.
- Use a unique user and database per app.
- Rotate passwords outside Git.
- Enable backups, SSL and monitoring.
