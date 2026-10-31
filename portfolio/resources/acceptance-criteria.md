# Write acceptance criteria for a form-to-dashboard repair

Acceptance criteria describe observable behavior. They help the buyer and developer decide when a scoped repair is ready to review.

For a request form, adapt this fictional example to your own application.

1. Valid input produces one saved request and a clear success state.
2. Repeating the same submission does not create an unintended duplicate.
3. Reloading the agreed view shows the saved record when persistence is required.
4. Invalid input explains what must be corrected.
5. A failed storage operation shows a failure state and preserves existing records.
6. The dashboard displays the fields agreed in scope.

Specify the actual persistence boundary. Browser-local storage, a shared server database and an email-delivery queue have different acceptance conditions. Confirm which one the project needs.

List the browser and fixture used to demonstrate the repair. Add a regression condition for the original defect and keep adjacent requirements visible. Screenshots alone cannot establish every backend outcome.

For a small paid engagement, agree on the modified files or pull request, the review evidence, one correction round and any deployment responsibility before work starts. Larger workflow changes need their own estimate.


[Original repair demonstration](../mvp-rescue/README.md) · [Request a written scope on Contra](https://contra.com/s/N3gqmcUE-mvp-rescue-fix-a-broken-form-or-dashboard-workflow)
