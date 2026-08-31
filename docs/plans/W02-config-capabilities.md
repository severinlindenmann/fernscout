# W02 — Config file + capability registry

**Roadmap:** A2, A7, A10, A11 · **Depends on:** nothing · **Wave A (serial)**

> This is the keystone. Almost every later package imports the registry.
> It merges to main before anything else starts.

## Goal
One committed config file says *what* is enabled. One registry resolves every
capability at boot against its requirements and reports clearly when a flag is
on but unconfigured. Secrets live only in the environment.

## Scope

### `content/config.json`
```jsonc
{
  "site":  { "title", "tagline", "url", "travellers": [...],
             "startLocation", "defaultLocale": "de",
             "locales": ["de","en","hu"], "baseCurrency": "CHF",
             "displayCurrencies": ["CHF","EUR","USD"], "units": "metric" },
  "features": {
    "reactions": { "enabled": true },
    "costs":     { "enabled": true },
    "push":      { "enabled": false },
    "mail":      { "enabled": false, "transport": "file" },
    "auth":      { "enabled": false },
    "contacts":  { "enabled": false },
    "postcards": { "enabled": false, "provider": "dry-run" },
    "photobook": { "enabled": false, "provider": "dry-run" }
  }
}
```

### `lib/capabilities.ts`
- Each capability declares `{ requiresEnv: string[], requiresDb: boolean }`.
- One boot-time resolve → `enabled | disabled(reason)`.
- **Nothing outside this module reads `process.env` for feature config.**
- Export a typed `capability("mail")` accessor and a `<IfEnabled>` helper.

### Failure behaviour (ROADMAP §1.1)
1. Disabled → **absent**, never a dead control.
2. Enabled but unconfigured → **named startup error**: which flag, which
   variable. Not a 500 later.
3. Never silently degrade.

### Config validation
Zod (or hand-rolled) schema with messages naming the offending key and what was
expected. Follow the `lib/trips.ts` instinct: log and degrade, never throw on a
single bad optional field — but a broken `features` block is fatal.

## Migration
`lib/site.ts` becomes a thin typed reader over `config.json`. Keep the export
shape so existing imports don't churn.

## Out of scope
Implementing any capability. This package only defines and validates them.

## Acceptance
- [ ] `content/config.json` + `config.example.json` + `.env.example`
- [ ] App boots with every feature off and renders the public site
- [ ] Enabling `mail` without `SMTP_HOST` fails at boot with a message naming both
- [ ] Unit tests: valid config, missing key, bad type, enabled-but-unconfigured
- [ ] No `process.env` reads for feature flags outside `lib/capabilities.ts`
