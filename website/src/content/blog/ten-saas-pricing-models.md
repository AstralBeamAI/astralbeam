---
title: "How to Price AI Agents in Your SaaS"
description: "What to charge for an agent in your app, what can go wrong, and the usage limits you'll need."
date: "2026-11-10"
author: "AstralBeam team"
image: "/blog/images/saas-pricing-models.png"
imageAlt: "A subscription and usage receipt shows the included allowance, extra work, and total against a customer-approved budget."
---

An agent can chase an invoice without getting it paid. You cover the calls, but you could charge for access, each investigation, or money recovered. Choose what customers can budget and you can measure, then decide whether it belongs in their plan, an add-on, or a usage bill.

Press **Start** to compare billing mistakes and better patterns. Prices are fictional, before tax. Community posts are anecdotes, not conversion or margin benchmarks.

## Work out what to charge for

### Access: a flat fee or a price per seat

A subscription lets people use your app without pricing every click. A [report-tool founder on HN](https://news.ycombinator.com/item?id=40376857) described that benefit. You can still set limits, as [Basecamp](https://basecamp.com/pricing) does.

You pay for the heavy users too. [Sam Altman said in January 2025](https://x.com/sama/status/1876104315296968813) that ChatGPT Pro was losing money because people used it more than expected. Look at your expensive customers, not just the average.

Our $49 example includes 200 attempts, but one loop takes compute to $65. A disclosed $0.15 cap per attempt stops it incomplete at $30 total. Failed attempts count. That's $19 before the rest of your expenses.

```pricing
fixed
```

Seats need purchase controls too. An invitation can add to the bill, so let the owner approve the increase and proration first. [Slack](https://slack.com/help/articles/218915077-Slacks-Fair-Billing-Policy) credits inactivity on eligible self-serve plans. [Strella chose seats](https://www.bvp.com/atlas/durable-monetization-how-four-ai-founders-solved-the-pricing-puzzle) to avoid per-project approvals, with inference a small cost beside participant compensation. Seats get awkward if your agent helps a smaller team do the same work. [One builder described that renewal problem](https://www.reddit.com/r/SaaS/comments/1scw6p8/comment/ogipj5s/) and switched to transactions processed.

```pricing
seats
```

### Usage: tokens, compute, or tool calls

Can your customer estimate a month's token usage? The rates at [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing) and [GitHub's billing explanation](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/) help explain the costs. A sample invoice may help them decide. [One founder](https://www.reddit.com/r/SaaS/comments/1r1k8sx/seat_vs_usage_based_pricing/) said usage pricing helped rollout, but prospects worried about spending. Established customers later asked for seats.

Alerts don't enforce budgets. Reserve money before concurrent jobs can spend it twice, then record actual usage and release anything unused. Limit each run too, since provider reports can arrive late.

```pricing
usage
```

You could bill for actions, as [Salesforce](https://www.salesforce.com/agentforce/pricing/) offers alongside conversations and user licenses. But does an attempted call count? What about a retry? [Zapier's task rules](https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier) get into those details. In our example, four successful tools leave the issue open. A two-action allowance stops at $0.20 and asks before doing more.

```pricing
tool
```

### Jobs: a workflow, export, or conversation

Your customer may know they need 500 reports a month without knowing the token count. A price per job gives them a budget. [n8n](https://n8n.io/pricing/) bills workflow executions. Specify input and duration limits, included services, and when you charge. With conversations, does returning tomorrow start a new one?

[Mintlify's cofounder](https://x.com/handotdev/status/2097459135747084603) described fixed prices per completed action while absorbing variable compute costs. You'd carry that risk too. Completing a job doesn't always solve the customer's problem.

Keep one job ID across retries so you don't charge twice for the same export. [Stripe's meter events](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api) process asynchronously, so keep durable records that distinguish retries from new orders.

```pricing
workflow
```

### Outcomes: a result both sides can check

If your agent recovers money, you can charge a share, as [Chargeflow](https://www.chargeflow.io/pricing) does for chargebacks. For support, [Fin](https://www.intercom.com/help/en/articles/8205718-fin-ai-agent-outcomes) counts confirmed and assumed resolutions, plus configured procedure handoffs. It reverses resolution charges when customers return to the same conversation for more help.

Agree on what counts as done and how customers can dispute it. The [Skope discussion on HN](https://news.ycombinator.com/item?id=44973758) gets into that evidence problem. You still pay for unsuccessful attempts.

Our fictional $1 charge needs customer confirmation and reverses if the issue reopens within seven days. Closing it again needs new confirmation. Seven days is our rule, not Fin's. [Ada](https://www.ada.cx/platform/) says most customers choose conversation pricing, with resolution pricing for specific enterprise needs.

```pricing
outcome
```

## Work out who pays the model bill

### Provider cost plus your fee

[Stripe](https://docs.stripe.com/billing/token-billing) supports cost plus markup. Say whether you bill list or negotiated rates and how caching, tools, and failed calls count. Save the rate used for each run.

A 20% markup on $10 makes a $12 bill. The $2 spread divided by $12 revenue is **16.7%**, before other serving costs. A 20% margin requires **$10 ÷ 0.8 = $12.50**, again excluding those costs.

```pricing
markup
```

### The customer's key plus your app fee

Customers with provider contracts may prefer their own keys. But connecting your provider key is different from asking each customer to create and fund an account. A [local dictation-app builder](https://www.reddit.com/r/SaaS/comments/1vuzeva/byok_sounded_fair_the_api_key_setup_is_where/) found setup difficult for nontechnical users. [Provider payment, permissions, and rate limits](https://www.reddit.com/r/SaaS/comments/1vuzeva/comment/p5672ua/) can also create support work.

Your app fee and the model bill need explaining separately. [OpenRouter's terms](https://openrouter.ai/pricing) are one example of those billing rules. Our simulation shows $29 charged while a $10 job is only authorized. Completing it brings combined spending to $39. Protect the key, show whose account a limit applies to, and ask before using a different paying account. Storage, tools, and support still come out of your fee.

```pricing
byok
```

## Make the bill easy to understand

### Show what a credit buys

What does $10 buy in your app? If customers can't work that out, credits add another calculation. [a16z makes that case](https://a16z.com/you-are-not-a-model-dont-price-per-token/), and [builders discuss it on Reddit](https://www.reddit.com/r/SaaS/comments/1alxaac/navigating_pricing_strategies_for_ai_saas_seeking/), alongside promotional replies. [One commenter wanted to buy named analyses](https://www.reddit.com/r/SaaS/comments/1hwm9q0/comment/m62meoc/) without a subscription or credit balance to manage.

Explain expiry, rollover, and promotional balances. Credits that expire unused increase what customers paid per completed job. Put a spending limit on auto-recharge too.

```pricing
credits
```

### Show what extra usage costs

You can include some agent work in a subscription and charge for the rest. [Bessemer's playbook](https://www.bvp.com/atlas/the-ai-pricing-and-monetization-playbook) covers this approach. Its [Ada interviews](https://www.bvp.com/atlas/durable-monetization-how-four-ai-founders-solved-the-pricing-puzzle) describe the appeal of predictable budgets. Those cases don't tell you which plan your customers will prefer.

At $49 for 200 workflows plus $0.30 each extra, 250 cost **$64**. If serving costs average $0.15 per completed workflow, including failed attempts, the work costs $37.50. That leaves $26.50 before other expenses. Check expensive runs too.

Show the extra $15 before approval, when allowances reset, and whether work stops at zero. Two prices take explaining, especially when terms change: see [Cursor's apology](https://cursor.com/en-US/blog/june-2025-pricing) and the [HN discussion](https://news.ycombinator.com/item?id=44470148).

```pricing
hybrid
```

## Test the bill before changing your plans

[Stripe's survey](https://stripe.com/blog/saas-platform-trends-in-AI-era) of 200 North American and European SaaS leaders, half Stripe customers, found a quarter planned seats plus agent charges. Those are seller plans. Ask buyers whether [Levie's comparison with work performed](https://x.com/levie/status/1976462057840181320) matches their own costs.

Show customers two pilot invoices for the same work. Count failures, retries, tools, support, and human review, then measure adoption, margin, and retention. If you sell [commitments](https://www.snowflake.com/en/pricing-options/), explain unused capacity, expiry, rollover, renewal, and true-ups. Does each tier reprice every unit or just the units in that band?

## Put the limits where the work happens

Before starting a job, the customer needs to see the estimate, rate, and who pays. During the run, **spent** means already used, **reserved** is held for work in progress, and **remaining** is available for new work. Agree on what happens at zero, including calls already running. Track the customer's account too. A conversation limit is easy to bypass by opening another chat.

Keep a receipt so customers can question a charge: job ID, billable event, quantity, rate version, allowance, and adjustments. Before calling a limit hard, read what it covers. [Vercel](https://vercel.com/docs/spend-management) documents timing restrictions, while [Snowflake's warehouse monitors](https://docs.snowflake.com/en/user-guide/resource-monitors) leave some serverless and AI usage outside their scope. Test it with concurrent jobs, late reports, a failed cancellation, and an empty balance.

## Try it in your app

With [AstralBeam](/), add agentic chat, connect tools, let users work with files, and set per-customer allowances. Track model spend while we handle the agent backend and conversation history.

[Try AstralBeam on Cloud](/auth/sign-up), follow the [quickstart](/docs/start/quickstart), or [tell us what you're building](mailto:hello@astralbeam.ai) and how you'd charge for it.
