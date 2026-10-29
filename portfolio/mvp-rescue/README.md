# MVP Rescue — functional repair demonstration

An original, synthetic project by Marco Bellocchio. It illustrates a specific before/after repair pattern; it is **not client work**, a production deployment, or evidence of past customer results.

## Try it

Download `demo.html` and open it in a current desktop browser. It is self-contained and makes no external requests. Use fictional information only. Browser-local storage may be unavailable for local files in some browsers; errors are shown rather than claiming a successful save.

Alternatively serve `dist/` using a static web server you already have. No package installation, paid service or API key is required.

1. Select **Before**. Save the example, then choose **Reload & verify**: the record disappears. This deliberately constructed regression fixture uses memory only.
2. Select **Fixed**. Save a request, click Save again: the submission remains a single record.
3. Reload: the fixed record remains in the dashboard.
4. **New request** starts another submission. **Export demo JSON** downloads the current version's records. Reset asks for explicit confirmation before deleting demo data.

The fixed version validates input, refuses corrupt/unsupported stored data without overwriting it, reports storage failures, bounds capacity at 100 requests, and renders text without HTML interpretation.

## Verification

Run with Node.js 20+:

```sh
node --test tests.mjs
```

On 29 October 2026: **15 tests passed, zero failed**. Tests cover persistence, duplicate submission, distinct submissions, validation/boundaries, corrupt JSON/schema preservation, storage failure, literal markup, capacity and invalid identifiers/dates.

Cloud Chrome UI verification on 29 October: initial empty state; fixed save; repeat submission still one request; persistence after reload; before fixture loses its request after reload; switching back retains fixed data. An initial browser compatibility issue with `crypto.randomUUID` on an HTTP preview was found and corrected using `crypto.getRandomValues`. No mobile-browser or production deployment certification is claimed.

## Scope and limits

This is a browser-local demonstration. It has no user authentication, shared server database, delivery of emails, payment processing, production monitoring or security certification. Browser storage is not a multi-user backend. The submission token is for demo duplicate prevention, not an authentication credential. Clearing browser data removes records. The email check is basic syntax validation, not mailbox verification. `Before` is intentionally broken and explicitly labelled.

Source: `dist/index.html`, `dist/app.mjs`, `dist/core.mjs`. `demo.html` packages the same source into one downloadable file. See [SERVICE.md](SERVICE.md) for the service proposal.
