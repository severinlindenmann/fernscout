# What a trip cost, from a bank statement

A budget is what somebody meant to spend. A statement is what left their
account, and it is the only record of the fortnight nobody wrote down at the
time.

Since B1624 this moved to `/api/v2` — the statement door is no longer keyed
through the same `kind` mechanism a location history goes through
(`docs/gps.md`, `POST /api/v2/<user>/import` with `kind: "gps"` or
`"contacts"`). "Import" now means that shared door's own verb; a bank
statement's read is a different call, on a different route.

## Three calls, because there are two decisions

```http
POST /api/v2/<user>/media
{"intent": {"kind": "bank_export", "trip": "<trip-id>"}, …}
```

Stage the CSV through the ordinary media door — `intent.kind: "bank_export"`
says what this upload is, the way `photo`, `gps_history` and `document` say
what theirs are. It answers with a `src` (an `inbox:<id>` reference today).

```http
GET /api/v2/<user>/statements/<src>
```

Read it back as a report, against the `src` the upload answered with. **This
writes nothing.** It answers with:

| | |
| --- | --- |
| `spending.days` | grouped by day, in what the account was charged |
| `spending.merchants` | biggest first — the list to agree categories against |
| `rates` | what a unit of each foreign currency **actually cost**, from the money the bank moved |
| `skipped` | transfers and money coming in, counted rather than hidden |

Then a person decides two things nobody else can, and only then:

```http
POST /api/v2/<user>/trips/<trip>/costs/apply
{"rows": [{"date": "2026-06-22", "label": "Padaria Central",
           "amount": 11.65, "currency": "CHF", "category": "food"}]}
```

Renamed from v1's `.../costs/import` in the same move: "import" is now the
media door's own verb, and this call does something different — it applies
agreed rows, it never imports anything itself. Writable by anybody who may
write the trip (a trip-scoped token included); only the statement *read*
above is owner-only, because a location-history-sized read of the whole
journal's bank export is not a trip-scoped decision.

## Why the split

**Which rows were the trip's.** The rent is in the statement. So is the phone
bill, and the standing order to somebody's mother.

**What each one was for.** A statement says what was paid and never what it was
for. The bank's own "Restaurants" is a guess about a merchant, not a decision
about a trip — it is dropped on the way in, deliberately, so that nothing
downstream can mistake it for an answer. `other` is a real category and a good
one; a plausible category an agent chose is the kind of fiction nobody catches
later.

Agree them **merchant by merchant**, which is why the list comes back sorted
that way: one decision covers every payment to that merchant.

## What the apply call does

- **Adds, never replaces.** Costs somebody wrote by hand stay. Sending the same
  rows twice writes them twice — visible on the day and correctable there,
  which is the honest behaviour for an append.
- **Picks the earliest day** when a date has several, by `time:` rather than by
  filename. A day written as "morning" and "evening" would otherwise take its
  costs on whichever slug sorted first.
- **Reports a date with no day** in `orphaned` and records nothing for it. A
  cost is never moved to a neighbouring day.
- **Refuses every bad field at once**, so forty rows with four mistakes are one
  round trip.

The rates are not written either — a trip's `rates` are a section of
`trip.json`, written with `PATCH /api/v2/<user>/trips/<trip>` (see
`docs/currencies.md`), and whether a trip's frozen rates should change is its
own decision.

## Adding a bank

`importers/costs/` is MIT, like `importers/gps/`. A `Payment` is
`{date, amount, currency, description}` with the sign the statement wrote —
negative is money out — plus an optional `charged` (what it cost the account,
where that differs, which is where a real exchange rate comes from) and
`transfer` for money moving between somebody's own pots.

`checkCostsImporter` is the function to run against your own. There is no
`dryRun` flag on this route — the whole call is read-only, so every request
already is one. Send the file and read what comes back.

## Where this came from

`fernscout-helper` did all of this on the owner's own laptop, in
`revolut-costs`. Nothing about parsing a CSV needs the machine the file came
from, and running it there meant a format change reached one checkout at a
time. B677 moved it. What stays in the helper is the half a server cannot do:
finding the statement on somebody's disk in the first place.
