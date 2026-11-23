# Activity log and compliance

VINAC Link keeps a record of **who did what** on each computer: pairings, requests and how your
firewall decided, approvals, keys sent, received and used, allowed runs, agents added, settings
changed. It never records message text, request arguments, file contents or secret values.

## The Activity log page

**Activity log** in the sidebar shows the record, newest first.

- **Search** across key names, commands, intents and device or agent names, and filter by **kind of
  event**, **who** (the person on this page, an agent, another device, or VINAC Link itself),
  **agent**, and **dates**.
- Each line says who did it. An agent added under *Secrets › Agents on this computer* shows with its
  name and **fingerprint** (`AGT-…`), so you can tell agents apart in reports.
- At the top: whether the **chain is intact**. Each line includes the fingerprint (SHA-256) of the
  one before it, so a changed or removed line is detected.

## Exports and signed reports

- **Export CSV**: every matching line, for a spreadsheet or your company's log system.
- **Signed report**: a JSON file signed with this computer's Ed25519 identity key (its fingerprint is
  shown on the page), plus a printable page you can save as PDF. It has a summary (by kind, by who,
  by agent, keys used, grants, approvals and denials) and the entries. Anyone can check it was not
  changed:

  ```
  vinac audit --check-report vinac-audit-report-2026-11-22.json
  ```

Making a report or an export is itself logged.

## How long the log is kept

Under **Keep the log for**: 3 months, 1 year (the default), 2 years, 7 years or always. Older months
are removed when they pass that age; the removal is logged and the chain still verifies from where it
now starts. **Legal hold** keeps everything regardless. Export first if you need older entries
elsewhere.

## From the command line

```
vinac audit --last 50                       newest entries
vinac audit --from 2026-11-01 --to 2026-11-30 --agent "Codex on the Mac"
vinac audit --category runs --csv > runs.csv
vinac audit --verify                        is the chain intact?
vinac audit --check-report report.json      is a signed report genuine and unchanged?
```

## What this helps with

The log, the reports and the person-in-the-loop design support the record-keeping that privacy and
AI rules ask for: in Canada, PIPEDA's accountability and safeguards principles and Quebec's Law 25;
in the federal government, the *Directive on Automated Decision-Making* and the *Guide on the use of
generative AI* (human review, logging and auditability). VINAC Link makes no decisions itself; it
records what people and agents did through it. This is not legal advice: check with your privacy
officer what your organization must keep, and for how long.

## Limits

- A program running as you could rewrite the whole log. Keep exports or signed reports somewhere
  else (or send them to your company's log system) to catch that.
- The log is per computer. A company-wide view comes with the planned Team edition.
