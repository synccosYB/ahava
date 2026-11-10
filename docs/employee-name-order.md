# Employee name correction

The app renders `firstName lastName`. The clock spreadsheet importer previously
stored `ABADI Miriam` as first name `ABADI`, last name `Miriam`. It now interprets
combined names as `Last First [Middle]`, or `Last, First [Middle]`. Separate
`First Name` and `Last Name` columns take precedence and preserve compound names.

Existing records need a data correction as well as the importer release. Run
these commands in the application's environment (with its `DATABASE_URL`), using
the Ahava Medical Center company ID:

```sh
npx tsx scripts/correct-employee-name-order.ts --preview /tmp/ahava-name-corrections.json COMPANY_ID
```

Review the saved JSON plan. It proposes swapping the existing name fields for
staff with clock numbers in that company. Records with matching, manually
corrected names in the audit log are excluded, including Miriam's correction
made on November 10. Accounts without clock numbers and other companies are
excluded. Review compound surnames and names already entered correctly; remove
those entries or adjust their `after` fields. Name boundaries cannot reliably
be inferred from a combined string.

```sh
npx tsx scripts/correct-employee-name-order.ts --apply /tmp/ahava-name-corrections.json
```

The apply step locks and checks each employee against the saved company, clock
number and original names, then changes only the name fields and update timestamp.
Each change has an audit record containing its before/after values. A stale plan
rolls back the entire batch. Replaying an applied plan makes no further changes.
No payroll, attendance, permissions or account IDs change. Do not commit the
generated plan to Git: it contains employee data.

GitHub changes do not republish the Replit deployment. Publish the importer fix
through the existing deployment workflow, run the reviewed correction, then
verify Team View, Employees, employee profiles and name-based searches.
