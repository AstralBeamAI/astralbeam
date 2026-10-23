# Usage limits

Usage limits cap tokens or model spend within a time window. Let's apply limits from your token endpoint and combine them into subscription plans. The examples use illustrative allowances.

## How a limit works

Each limit belongs to your Organization and counts usage separately for every subject in its scope. Chat refuses a new message once a subject has used its allowance, until that subject's window resets.

| Field | Options | What it means |
| --- | --- | --- |
| Apply to every tenant user | On or off | On makes this a default limit that every chat token gets. Off applies it only to tokens that list its ID. |
| Name | Up to 100 characters | Shown to tenant users when they reach the limit, so plans may share a name such as "Weekly limit". |
| Scope | Global, Per tenant, Per tenant user, Per conversation | Whose usage shares one allowance. Global is one allowance for the whole Organization. |
| Duration | Monthly, Weekly, Daily, or a custom number of minutes, hours, days, weeks, or months | How long a window lasts, up to one year. |
| Window | Fixed or Rolling | When a window starts. See [Fixed and rolling windows](#fixed-and-rolling-windows). |
| Time zone | Any IANA time zone | Where fixed windows reset, such as midnight or the 1st of the month. |
| Metric | Tokens or Spend (USD) | What the limit counts. |
| Limit | Whole tokens, or dollars with up to two decimal places | The allowance per window. |
| Enabled | The switch on each row of the list | A disabled limit is neither counted nor enforced, even for tokens that list it. |

Tokens are a model call's input and output tokens, including cached input. Spend is that call's cost at the model's configured price when it finished. See [Models](./models.md) for prices.

**NOTE**: a model without a price adds tokens to every limit but no spend, so give each model a price before relying on spend limits.

## Fixed and rolling windows

A fixed window follows the calendar in its time zone. Monthly resets at midnight on the 1st, Weekly at midnight on Monday, and Daily at midnight. A custom fixed window lines up with whole multiples of its duration, so 6 hours resets at 00:00, 06:00, 12:00, and 18:00, and 3 months resets at the start of each quarter. Every subject shares the same reset times, which makes a fixed window right for billing periods and for limits you announce as "resets on the 1st".

A rolling window starts at a subject's first use and resets one duration later. The next use after that starts a new window. Each subject gets the whole duration from the moment they begin, rather than sharing a calendar reset time.

**NOTE**: rolling windows are sessions, not sliding windows. A sliding window would forget each call exactly one duration after it happened, so its remaining allowance would change continuously and could not answer "when can I chat again" with one time. A session gives tenant users one clear reset time and needs one counter per subject.

## Apply limits from your token

Default limits apply to everyone, so you need nothing more than the dashboard for limits that suit all your users. Limits that should apply only to some users, such as one plan's, are applied by your token endpoint, which already knows the signed-in user's plan.

Let's apply a plan's limits when minting the token:

1. Create the plan's limits with **Apply to every tenant user** turned off.
2. Copy each limit's ID from the **Usage Limits** table, or from the snippet on its page.
3. Pass the IDs for the user's plan as `usageLimits` when your server mints the token.

```ts
import { createAstralBeamToken } from "@astralbeam/sdk/server"

const planLimits: Record<string, string[]> = {
  free: ["limit_<organizationId>_<freeSessionId>"],
  pro: ["limit_<organizationId>_<proSessionId>", "limit_<organizationId>_<proWeeklyId>"],
}

const token = await createAstralBeamToken({
  apiKey,
  user: { id: session.user.id, name: session.user.name },
  tenant: { id: session.tenant.id, name: session.tenant.name },
  usageLimits: planLimits[session.tenant.plan] ?? [],
})
```

- Every enabled default limit applies to every token, and a token cannot remove one. The limits a token lists apply in addition.
- A request must stay within every limit that applies. The most restrictive one decides.
- Global limits always apply to everyone, because they count the whole Organization's usage.
- A token lists at most 20 IDs. `createAstralBeamToken` throws for a malformed ID, so a typo fails on your server instead of silently applying nothing.
- A listed ID that names a deleted or disabled limit is ignored, so deleting a limit takes effect without redeploying your token endpoint.

A backend in another language adds the IDs to the token's `usage_limits` claim. See [Mint tokens without JavaScript](/docs/sdk/authentication#mint-tokens-without-javascript).

## What tenant users see

Chat checks every applicable limit before it accepts a message. Once a limit is used up, the request fails with `429`, a `Retry-After` header, and a `usage_limit` member naming the limit and when it resets. The widget keeps the unsent message and shows, for example, "Weekly limit reached. You can chat again after Oct 19, 2026, 12:00 AM", in the reader's own time zone.

A run can make several model calls while it uses tools, so chat checks again before each further call. When a limit runs out partway through, the run ends after the current step and the widget shows the same message.

A browser tool may already have changed your application by the time its result arrives, so chat always saves a valid tool result. When no allowance is left for the model call that would follow, the response is a receipt with the same `usage_limit` member instead of a continuation, and the conversation resumes from the saved result once the limit resets.

**NOTE**: usage is known only after a model call finishes, so the call that crosses a limit completes, and calls already running at the same time can each finish past it. A limit can therefore be exceeded by at most the calls in flight.

Your own interface can show how much of each limit is left. `getChatUsage` from `@astralbeam/sdk/api` returns the limits that apply to the current tenant user, their usage so far, and when each window resets.

```ts
import { getChatUsage } from "@astralbeam/sdk/api"

const { usageLimits } = await getChatUsage({ threadId }, { astralBeamToken })
for (const limit of usageLimits) {
  console.log(
    `${limit.name}: ${limit.used} of ${limit.amount}, resets ${limit.resetsAt ?? "after first use"}`,
  )
}
```

Pass the `threadId` of a conversation the tenant user participates in to include per-conversation limits.

## What counts toward a limit

Each limit counts the usage of the requests it applies to, starting when it is created or enabled. A new limit therefore starts every subject at zero, and a tenant user who moves to a plan with different limits starts those limits at zero too.

Editing a limit's name, amount, or metric keeps the usage already counted, because every limit counts both tokens and spend. Changing its scope, duration, window, or time zone restarts counting, because the old counts belong to different subjects or a different reset time. Deleting a limit discards its counts.

Usage belongs to the subject that made it. Deleting a tenant, tenant user, or conversation removes its counts for every limit, so the tenant user's history restarts if your application later recreates them.

## See who is close to a limit

Each limit's page lists the tenants, tenant users, or conversations with usage in their current window, most used first, 20 to a page. Every row shows the usage so far, its share of the limit, and when that subject's window resets. A Global limit has one row for the whole Organization. Subjects whose windows have ended drop off the list until their next use.

## Example: session and weekly allowances

Let's combine a five-hour session allowance with a weekly cap. Both plans use the same windows, and the higher tier raises both allowances.

| Name          | Applies to | Scope           | Duration | Window     | Metric | Limit      |
| ------------- | ---------- | --------------- | -------- | ---------- | ------ | ---------- |
| Session limit | Pro tokens | Per tenant user | 5 hours  | Rolling    | Tokens | 200,000    |
| Weekly limit  | Pro tokens | Per tenant user | Weekly   | Fixed, UTC | Tokens | 2,000,000  |
| Session limit | Max tokens | Per tenant user | 5 hours  | Rolling    | Tokens | 1,000,000  |
| Weekly limit  | Max tokens | Per tenant user | Weekly   | Fixed, UTC | Tokens | 10,000,000 |

The rolling session gives every user five hours from their first message, so a heavy morning cannot use up the afternoon. The weekly limit caps sustained use, and because both apply at once, whichever runs out first stops the user. Both plans name their limits identically, so a tenant user reads "Session limit reached" whichever plan they are on.

Your token endpoint then lists the user's plan:

```ts
const planLimits = {
  pro: [PRO_SESSION_LIMIT_ID, PRO_WEEKLY_LIMIT_ID],
  max: [MAX_SESSION_LIMIT_ID, MAX_WEEKLY_LIMIT_ID],
}
```

**TIP**: Usage limits count all of an agent's models together. Use Spend when more expensive models should consume an allowance faster.

## Example: different windows per plan

Let's give an entry plan both five-hour and weekly limits, while a higher tier has only a weekly cap.

| Name            | Applies to  | Scope           | Duration | Window     | Metric | Limit  |
| --------------- | ----------- | --------------- | -------- | ---------- | ------ | ------ |
| Five-hour limit | Plus tokens | Per tenant user | 5 hours  | Rolling    | Spend  | $1.00  |
| Weekly limit    | Plus tokens | Per tenant user | Weekly   | Fixed, UTC | Spend  | $8.00  |
| Weekly limit    | Pro tokens  | Per tenant user | Weekly   | Fixed, UTC | Spend  | $60.00 |

Plus tokens list two limits and Pro tokens list one, so Pro users can work as intensively as they like within the week. Spend makes an expensive model's calls count for more, as a message allowance that varies by model does.

## Example: a B2B product with seat-based plans

A SaaS company sells its assistant to other businesses, which are its tenants. Each customer's plan includes a monthly AI budget, every seat should get a fair share, and the company wants a ceiling on its own model bill. Let's combine three scopes.

| Name | Applies to | Scope | Duration | Window | Metric | Limit |
| --- | --- | --- | --- | --- | --- | --- |
| Monthly AI budget | Business plan tokens | Per tenant | Monthly | Fixed, the customer's time zone | Spend | $200.00 |
| Daily fair use | Everyone | Per tenant user | Daily | Rolling | Tokens | 500,000 |
| Long conversation | Everyone | Per conversation | Weekly | Rolling | Tokens | 2,000,000 |
| Platform ceiling | Everyone | Global | Monthly | Fixed, UTC | Spend | $5,000.00 |

The tenant budget follows the customer's own billing month. Fixed windows take one time zone per limit, so create a budget per region you bill in, such as one in `America/New_York` and one in `Europe/Berlin`, and list the one matching the customer's account. Daily fair use stops one enthusiastic seat from spending the whole team's budget by lunchtime. The conversation limit prompts users to start fresh before a single conversation's growing context gets expensive. The global ceiling protects the company's bill if every customer is busy at once, and its name tells tenant users the pause is temporary.

## Who can change limits

Owners and developers can read, create, edit, enable, disable, and delete usage limits. Viewers cannot open these pages. See [Members](./members.md).
