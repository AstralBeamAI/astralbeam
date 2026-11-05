# Usage limits

Set a token allowance or model-spend budget for your customers. Start with a default limit for everyone, then add plan-specific limits when your product needs them.

## Create a limit

1. Open **Usage Limits** as an owner or developer and choose **Add limit**.
2. Give it a customer-facing name and choose who shares the allowance. For a customer budget, choose **Per tenant**.
3. Choose **Tokens** or **Spend (USD)**, enter an allowance, and choose when it resets. For a monthly budget, use **Monthly** with a **Fixed** window and your chosen time zone.
4. Enable **Apply to every tenant user** for a default limit, or leave it off for a plan-specific limit.
5. Choose **Create limit**. For a plan-specific limit, [add its ID to your token](#apply-limits-from-your-token).

Open the saved limit to inspect usage and reset times. Test with a disposable user and a small allowance. Model calls incur provider charges.

## How a limit works

Each limit belongs to your Organization and counts usage separately for every subject in its scope. Chat refuses a new message once a subject has used its allowance, until that subject's window resets.

| Scope            | Who shares the allowance           |
| ---------------- | ---------------------------------- |
| Global           | Everyone in your Organization      |
| Per tenant       | All users of one customer account  |
| Per tenant user  | One user within a customer account |
| Per conversation | One conversation                   |

Tokens are a model call's input and output tokens, including cached input. Spend is that call's cost at the model's configured price when it finished. See [Models](./models.md) for prices.

**NOTE**: A model without a price adds no spend. Give each model a price before relying on spend limits. Disabled limits are neither counted nor enforced.

## Fixed and rolling windows

A fixed window resets on calendar boundaries in the selected time zone. Monthly resets on the 1st, Weekly on Monday, and Daily at midnight. Use it for a calendar-month budget.

A rolling window starts at each subject's first use and resets one duration later. For example, a five-hour allowance first used at 10:00 resets at 15:00. The next use starts a new window.

Rolling usage resets all at once. It does not expire each model call separately as a sliding lookback would.

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

Every enabled default limit applies alongside the token's plan-specific limits. A request must stay within all of them, and a token cannot remove a default. Global limits always apply to everyone. Tokens accept up to 20 limit IDs and ignore deleted or disabled limits.

A backend in another language adds the IDs to the token's `usage_limits` claim. See [Mint tokens without JavaScript](/docs/sdk/authentication#mint-tokens-without-javascript).

## What tenant users see

When a limit is reached, chat returns `429` with `Retry-After` and a `usage_limit` object naming the limit and reset time. The widget keeps the unsent message and shows when chat can resume in the user's time zone. Multi-step runs check again before each model call.

Completed browser tool results are saved when a limit blocks continuation, so the conversation can resume from them after reset.

**NOTE**: Calls already in flight can finish beyond the allowance. Usage limits are not an exact preauthorization of model cost.

To show remaining allowances in your own UI:

```ts
import { getChatUsage } from "@astralbeam/sdk/api"

const { usageLimits } = await getChatUsage({ threadId }, { astralBeamToken })
```

Each limit includes `name`, `used`, `amount`, and `resetsAt`. Pass a conversation the user participates in to include per-conversation limits.

## What counts toward a limit

Counting starts when a limit is created or enabled. New limits start at zero, including when a user changes to a plan with different limits.

Editing the name, amount, or metric keeps existing counts. Changing the scope, duration, window, or time zone restarts them. Deleting a limit discards its counts.

Deleting a Tenant, TenantUser, or conversation also removes its counts. Recreating it starts a new usage history.

## See who is close to a limit

Open a limit to see current usage by Tenant, user, or conversation, most used first. Each row shows the allowance used and reset time. Global limits have one organization-wide row.

## Example: session and weekly allowances

Combine a five-hour allowance with a weekly cap for one plan. These numbers are examples, not pricing recommendations:

| Name          | Applies to | Scope           | Duration | Window     | Metric | Limit     |
| ------------- | ---------- | --------------- | -------- | ---------- | ------ | --------- |
| Session limit | Pro tokens | Per tenant user | 5 hours  | Rolling    | Tokens | 200,000   |
| Weekly limit  | Pro tokens | Per tenant user | Weekly   | Fixed, UTC | Tokens | 2,000,000 |

List both IDs in Pro users' tokens. Either limit can stop further calls. For another plan, create limits with its allowances and select those IDs in your token endpoint.

Usage limits count all of an agent's models together. Use Spend when more expensive models should consume an allowance faster. You can combine customer budgets with per-user or per-conversation caps. A conversation cap alone does not limit a customer who starts more conversations.

## Who can change limits

Owners and developers can manage usage limits. Viewers cannot access these pages. See [Members](./members.md).
