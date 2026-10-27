# Usage limits

Cap tokens or model spend for an organization, customer, user, or conversation. Limits can apply to everyone or to plans selected by your token endpoint. The allowances below are examples, not pricing recommendations.

## Create a limit

1. Open **Usage Limits** as an owner or developer and choose **Add limit**.
2. Enter a customer-facing name, scope, metric, allowance, and reset window.
3. Enable **Apply to every tenant user** for a default limit, or leave it off for a plan-specific limit.
4. Choose **Create limit**. For a plan-specific limit, [add its ID to your token](#apply-limits-from-your-token).

Open the saved limit to inspect usage and reset times. Test with a disposable user and a small allowance. Model calls incur provider charges.

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

A fixed window follows the calendar in its time zone. Monthly resets at midnight on the 1st, Weekly at midnight on Monday, and Daily at midnight. Custom windows align to multiples of their duration: six hours resets at 00:00, 06:00, 12:00, and 18:00, while three months resets each quarter. Subjects share those reset times.

A rolling window starts at the subject's first use and resets one duration later. The next use starts a new window.

**NOTE**: Rolling windows are sessions, not sliding lookbacks. Usage resets together at one time, rather than expiring each call separately.

## Apply limits from your token

Default limits need no token changes. For plan-specific limits, let your backend select IDs from the authenticated customer's plan:

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
  user: { id: session.user.id },
  tenant: { id: session.tenant.id },
  usageLimits: planLimits[session.tenant.plan] ?? [],
})
```

- Every enabled default limit applies to every token, and a token cannot remove one. The limits a token lists apply in addition.
- A request must stay within every applicable limit.
- Global limits always apply to everyone, because they count the whole Organization's usage.
- A token accepts up to 20 valid limit IDs.
- A listed ID that names a deleted or disabled limit is ignored, so deleting a limit takes effect without redeploying your token endpoint.

A backend in another language adds the IDs to the token's `usage_limits` claim. See [Mint tokens without JavaScript](/docs/sdk/authentication#mint-tokens-without-javascript).

## What tenant users see

When a limit is reached, chat returns `429` with `Retry-After` and a `usage_limit` object naming the limit and reset time. The widget keeps the unsent message and shows when chat can resume in the user's time zone. Multi-step runs check again before each model call.

Already-completed browser tool results are saved even when a limit blocks continuation. Resume from the saved result after reset.

**NOTE**: Calls already in flight can finish beyond the allowance. Usage limits are not an exact preauthorization of model cost.

To show remaining allowances in your own UI:

```ts
import { getChatUsage } from "@astralbeam/sdk/api"

const { usageLimits } = await getChatUsage({ threadId }, { astralBeamToken })
```

Each limit includes `name`, `used`, `amount`, and `resetsAt`. Pass a conversation the user participates in to include per-conversation limits.

## What counts toward a limit

Each limit counts the usage of the requests it applies to, starting when it is created or enabled. A new limit therefore starts every subject at zero, and a tenant user who moves to a plan with different limits starts those limits at zero too.

Editing a limit's name, amount, or metric keeps the usage already counted, because every limit counts both tokens and spend. Changing its scope, duration, window, or time zone restarts counting, because the old counts belong to different subjects or a different reset time. Deleting a limit discards its counts.

Usage belongs to the subject that made it. Deleting a tenant, tenant user, or conversation removes its counts for every limit, so the tenant user's history restarts if your application later recreates them.

## See who is close to a limit

Open a limit to see current usage by Tenant, user, or conversation, most used first. Each row shows the allowance used and reset time. Global limits have one organization-wide row.

## Example: session and weekly allowances

Let's combine a five-hour session allowance with a weekly cap. Both plans use the same windows, and the higher tier raises both allowances.

| Name          | Applies to | Scope           | Duration | Window     | Metric | Limit      |
| ------------- | ---------- | --------------- | -------- | ---------- | ------ | ---------- |
| Session limit | Pro tokens | Per tenant user | 5 hours  | Rolling    | Tokens | 200,000    |
| Weekly limit  | Pro tokens | Per tenant user | Weekly   | Fixed, UTC | Tokens | 2,000,000  |
| Session limit | Max tokens | Per tenant user | 5 hours  | Rolling    | Tokens | 1,000,000  |
| Weekly limit  | Max tokens | Per tenant user | Weekly   | Fixed, UTC | Tokens | 10,000,000 |

Both limits apply. Either can stop further calls, and matching display names keep messages consistent across plans.

Select both IDs for the user's plan in the token endpoint, as [shown above](#apply-limits-from-your-token).

**TIP**: Usage limits count all of an agent's models together. Use Spend when more expensive models should consume an allowance faster.

## Example: different windows per plan

Let's give an entry plan both five-hour and weekly limits, while a higher tier has only a weekly cap.

| Name            | Applies to  | Scope           | Duration | Window     | Metric | Limit  |
| --------------- | ----------- | --------------- | -------- | ---------- | ------ | ------ |
| Five-hour limit | Plus tokens | Per tenant user | 5 hours  | Rolling    | Spend  | $1.00  |
| Weekly limit    | Plus tokens | Per tenant user | Weekly   | Fixed, UTC | Spend  | $8.00  |
| Weekly limit    | Pro tokens  | Per tenant user | Weekly   | Fixed, UTC | Spend  | $60.00 |

Plus tokens list both limits. Pro tokens list only the weekly cap. Spend makes calls to more expensive models consume the allowance faster.

## Example: a B2B product with seat-based plans

For a B2B product, combine a customer budget with user and conversation caps, plus an organization-wide ceiling:

| Name | Applies to | Scope | Duration | Window | Metric | Limit |
| --- | --- | --- | --- | --- | --- | --- |
| Monthly AI budget | Business plan tokens | Per tenant | Monthly | Fixed, the customer's time zone | Spend | $200.00 |
| Daily fair use | Everyone | Per tenant user | Daily | Rolling | Tokens | 500,000 |
| Long conversation | Everyone | Per conversation | Weekly | Rolling | Tokens | 2,000,000 |
| Platform ceiling | Everyone | Global | Monthly | Fixed, UTC | Spend | $5,000.00 |

Each fixed limit has one time zone. Create separate regional budgets, such as `America/New_York` and `Europe/Berlin`, and select the customer's region in the token endpoint. User and conversation caps constrain individual usage. The global ceiling covers all customers together. A per-conversation limit does not replace a user or tenant budget, since users can start another conversation.

## Who can change limits

Owners and developers can read, create, edit, enable, disable, and delete usage limits. Viewers cannot open these pages. See [Members](./members.md).
