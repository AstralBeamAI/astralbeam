---
title: "How to Price AI Agents in Your SaaS"
description: "What to charge for an agent in your app, what can go wrong, and the usage limits you'll need. With examples you can try."
date: "2026-11-10"
author: "AstralBeam team"
image: "/blog/images/saas-pricing-models.png"
imageAlt: "A subscription and usage receipt shows the included allowance, extra work, and total against a customer-approved budget."
---

You have a SaaS product. You're adding an agent. Do you include it in the plan, sell an AI add-on, or charge for usage?

Take an overdue invoice. The agent reads the contract, searches records, retries a tool, and drafts a reminder. You've paid for those calls. Your customer still hasn't been paid.

What should go on the bill: access to the agent, calls made, invoices chased, or money recovered? It depends on what customers will pay for and what you can measure. The model bill and your pricing don't have to use the same unit.

Press **Start** in each example to see what goes wrong and how to handle it. Products and prices are fictional, before tax. The community posts are individual experiences. They don't tell us what conversion or margin improvement to expect.

## Work out what to charge for

### Access: a flat fee or a price per seat

A subscription lets customers use the product without deciding whether every click is worth paying for. A [report-tool founder on Hacker News](https://news.ycombinator.com/item?id=40376857) described that benefit. Fixed plans can still have limits, as [Basecamp's plans](https://basecamp.com/pricing) do.

You carry the cost of heavy use. In [January 2025, Sam Altman reported](https://x.com/sama/status/1876104315296968813) that ChatGPT Pro subscriptions were losing money because people used them more than expected. Check your expensive customers as well as the average.

In our $49 example, 200 attempts are included, yet one looping run takes compute to $65. A disclosed $0.15 cap per attempt stops the last run incomplete at $30 total compute. Failed attempts count. The $19 left still has other costs to cover.

```pricing
fixed
```

Seats give you a different purchase decision. Three $20 seats cost $60. Invite five colleagues and the bill becomes $160. Show the increase and proration before the owner approves it.

[Slack](https://slack.com/help/articles/218915077-Slacks-Fair-Billing-Policy) bills active members and credits inactivity on eligible self-serve plans. In [Bessemer's interviews](https://www.bvp.com/atlas/durable-monetization-how-four-ai-founders-solved-the-pricing-puzzle), Strella chose seats to avoid per-project approvals, with inference costs small beside participant compensation.

The tradeoff changes if your agent helps a smaller team do the same work. [One builder on Reddit](https://www.reddit.com/r/SaaS/comments/1scw6p8/comment/ogipj5s/) described an awkward renewal and a switch from seats to transactions processed. Check whether paid seats will still match how your customers use the product after adopting the agent.

```pricing
seats
```

### Usage: tokens, compute, or tool calls

Tokens or compute can work for a technical buyer. A short question and a long agent run cost different amounts, as [Anthropic's rates](https://platform.claude.com/docs/en/about-claude/pricing) and [GitHub's Copilot billing explanation](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/) show. Can your customer estimate either before using your app?

[One SaaS founder](https://www.reddit.com/r/SaaS/comments/1r1k8sx/seat_vs_usage_based_pricing/) found usage pricing helped customers roll out the product. Some prospects still worried about the bill. Once usage grew, established customers asked for seats to limit spending. A sample invoice gives you something concrete to discuss with both groups.

In the example, a $10 alert arrives, but the job keeps running to $16. If only $2 remains, reserve it when the next job starts so another job can't spend it too. Record the actual cost and return the unused amount. Each run needs its own limit because provider reports can arrive after you've spent the money.

```pricing
usage
```

Charging for tool calls is easier to count than charging for a result. [Salesforce](https://www.salesforce.com/agentforce/pricing/) sells action-based Flex Credits, conversations, and user licenses. But what about a call that fails, or succeeds only after a retry? [Zapier's task rules](https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier) are a useful reference for deciding which calls belong on the bill.

In the simulation, the agent makes four successful calls at $0.10 each without fixing the issue. Would your customer be happy paying $0.40 for that? Try the two-action allowance instead. It stops at $0.20 for approval to continue, with a receipt showing the work done and the issue still open.

```pricing
tool
```

### Jobs: a workflow, export, or conversation

Your customer needs 500 reports a month. They probably don't know how many tokens that takes. Charge per report and they can work out a budget. [n8n](https://n8n.io/pricing/) charges for workflow executions. For your own jobs, define the input limits, duration, included services, and billing point. If you charge per conversation, does returning tomorrow count as a new one?

[Mintlify cofounder Han Wang](https://x.com/handotdev/status/2097459135747084603) described charging a fixed price per completed AI action and absorbing the difference in compute cost. You'd carry that risk too. Also agree on what "completed" means. An export can finish successfully while the customer's wider problem stays open.

Watch the retry in this example. The export finishes, its acknowledgement gets lost, and the customer is charged twice. Keep the same job ID on retry and charge once when you record completion. [Stripe's meter events](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api) support retry identifiers, but usage is processed asynchronously. Keep a durable record of the job so you can tell a retry from a new order.

```pricing
workflow
```

### Outcomes: a result both sides can check

If your agent recovers money, you can charge a share of it. [Chargeflow](https://www.chargeflow.io/pricing) does this for recovered chargebacks. A support ticket is harder to judge. [Fin](https://www.intercom.com/help/en/articles/8205718-fin-ai-agent-outcomes) counts confirmed and assumed resolutions, plus other outcomes such as configured procedure handoffs. It reverses resolution charges when a customer returns to the same conversation for more help.

Before quoting a price, agree on what counts as done, who checks it, and how either side can dispute it. The [Skope discussion on Hacker News](https://news.ycombinator.com/item?id=44973758) raises that evidence problem. You'll be paying for the failed attempts too.

In our fictional example, customer confirmation creates a $1 charge. Reopening the issue within seven days reverses it. Closing it again needs new confirmation. Those seven days are our example's rule, not Fin's.

Check that customers want this deal. [Ada](https://www.ada.cx/platform/) says most choose conversations, though it offers resolution pricing for specific enterprise needs.

```pricing
outcome
```

## Work out who pays the model bill

### Provider cost plus your fee

If you pay the provider, you can pass the cost through with a fee. [Stripe's token billing](https://docs.stripe.com/billing/token-billing) supports this. Decide whether to use list prices or negotiated rates, and how caching, tools, and failures count. Save the rate used for each run.

On a $10 provider bill, a 20% markup adds $2. Your $12 sale leaves **16.7% of revenue** after that cost. For a 20% margin, charge **$10 ÷ 0.8 = $12.50**. Both leave other serving costs out. Markup alone won't tell you whether the customer is profitable.

```pricing
markup
```

### The customer's key plus your app fee

Bring your own key can suit customers with existing provider contracts. Your $29 app fee and their $10 model bill still add up to $39. [OpenRouter's terms](https://openrouter.ai/pricing) show why the charges need explaining separately.

Be clear about whose key you mean. Connecting your SaaS to a model provider is different from asking each of your customers to create and fund a provider account. [A local dictation-app builder](https://www.reddit.com/r/SaaS/comments/1vuzeva/byok_sounded_fair_the_api_key_setup_is_where/) found key setup was a barrier for nontechnical users. A [commenter on that thread](https://www.reddit.com/r/SaaS/comments/1vuzeva/comment/p5672ua/) also pointed out that provider payment, rate-limit, and key-permission problems can make your app look broken. Test that setup with your customers before choosing BYOK.

Protect the key and say which account each limit covers. Ask before falling back to another account with a different bill. Also separate authorized spend from actual charges: our example stays at $29 until the $10 job finishes. Your fee still needs to cover storage, tools, and support.

```pricing
byok
```

## Make the bill easy to understand

### Show what a credit buys

A customer buys 100 credits for $10. A standard job uses one credit and a premium job uses ten. Five premium jobs leave 50 credits. Five standard jobs then leave 45.

[Andreessen Horowitz](https://a16z.com/you-are-not-a-model-dont-price-per-token/) argues that renaming tokens does little if buyers still cannot forecast work. Builders discuss that problem on [Reddit](https://www.reddit.com/r/SaaS/comments/1alxaac/navigating_pricing_strategies_for_ai_saas_seeking/), alongside promotional replies.

Occasional users may prefer a direct purchase. In a review-analysis tool discussion, [one commenter wanted to buy named analyses](https://www.reddit.com/r/SaaS/comments/1hwm9q0/comment/m62meoc/) without a subscription or credit balance to track. If credits expire unused, the customer pays more per completed job. Check that effective price too.

Show the conversion before purchase and execution. Explain expiry, rollover, and promotional balances. Give auto-recharge its own spending limit.

```pricing
credits
```

### Show what extra usage costs

Already selling a subscription? You can include an allowance for the agent, then price the extra work. [Bessemer's playbook](https://www.bvp.com/atlas/the-ai-pricing-and-monetization-playbook) covers this setup. Its [Ada interviews](https://www.bvp.com/atlas/durable-monetization-how-four-ai-founders-solved-the-pricing-puzzle) explain why predictable annual budgets matter to buyers. Those cases don't establish that a hybrid plan will work best for your app.

The example's $49 plan includes 200 workflows. Another 50 at $0.30 each brings the bill to **$64**. At an average serving cost of $0.15 per completed workflow, with failed attempts included in that average, all 250 cost $37.50. That leaves $26.50 for other business expenses. A few expensive runs could eat into it, so look beyond the average.

[Cursor's July 2025 apology](https://cursor.com/en-US/blog/june-2025-pricing) is a good reason to explain allowances carefully. Read the [HN discussion](https://news.ycombinator.com/item?id=44470148) too. Buyers were trying to work out what the plan now bought them. For our example, the owner should see "$15 for 50 more workflows" before approving the work. Show when the allowance resets and whether work stops at zero. If either the allowance or rate changes, show what that does to their bill.

```pricing
hybrid
```

## Test the bill before changing your plans

[Stripe's October 2026 report](https://stripe.com/blog/saas-platform-trends-in-AI-era) found a quarter of surveyed leaders planned to keep seats and add agent charges. The March survey covered 200 SaaS platform leaders in North America and Europe, half Stripe customers. Those are seller plans. Your buyers may want something else.

Ask which budget pays, who approves extra spend, and what would make the bill unacceptable. [Aaron Levie](https://x.com/levie/status/1976462057840181320) suggests comparing agent spend with work performed. Let customers check the claimed saving against their own costs.

Try two pricing plans against the same usage. Count failures, retries, tools, support, and human review. Show pilot invoices before charging. If you add commitments, as [Snowflake](https://www.snowflake.com/en/pricing-options/) does, explain unused capacity, expiry, rollover, renewal, and true-ups. Say whether a tier reprices every unit or only the units in that band.

Measure adoption, margins, and retention during the pilot.

## Put the limits where the work happens

Put the estimate beside the action that starts the job, along with the rate and who pays. During the run, **spent** is money already used, **reserved** is held for work in progress, and **remaining** is available for new work. Agree in advance whether to pause, fall back, or allow overage at zero, including what happens to calls already running.

Track spend per customer account in your app. You may also want limits per user or conversation. A user who reaches a conversation limit can just open another chat, so that alone won't protect the account's budget.

When someone asks why they were charged twice, you need a receipt. Keep the job ID, billable event, quantity, rate version, allowance, and any adjustments. The customer shouldn't have to reconstruct the agent's run to question a charge.

Does your limit cover every service that can spend money? [Vercel](https://vercel.com/docs/spend-management) documents timing and coverage restrictions. [Snowflake's warehouse monitors](https://docs.snowflake.com/en/user-guide/resource-monitors) leave some serverless and AI usage outside their scope. Before promising a hard cap, try concurrent jobs, late reports, a cancellation that fails, and an empty credit balance.

## Try it in your app

With [AstralBeam](/), add agentic chat, connect your tools, and let users work with files. Set allowances for each customer and track model spend. We handle the agent backend and conversation history.

Bring one task your customers already do. [Try AstralBeam on Cloud](/auth/sign-up), or follow the [quickstart](/docs/start/quickstart). [Tell us what you're building](mailto:hello@astralbeam.ai) and how you want to charge for it.
