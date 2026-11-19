---
title: "How to Price AI Agents in Your SaaS"
description: "What to charge for an agent in your app? Learn what can go wrong and how to set proper usage limits."
date: "2026-11-13"
author: "AstralBeam team"
image: "/blog/images/saas-pricing-models.png"
imageAlt: "A subscription and usage receipt shows the included allowance, extra work, and total against a customer-approved budget."
---

When you add an AI agent to your SaaS, you need a pricing model customers can understand and your business can afford. You can charge for access, usage, completed jobs, or outcomes. You also need to decide who pays the model provider and what usage limits to set.

These choices affect both the bill and the risk you take on. For example, a finance app might use an agent to send reminders for overdue invoices and check payment status. That work has a cost even when the invoice stays unpaid.

This guide compares the main pricing options, shows where each can go wrong, and explains the usage limits that help keep spending predictable. The prices in the examples are illustrative.

```glossary
## What to charge for?

- [**Access:** a flat fee or a price per seat](#access-a-flat-fee-or-a-price-per-seat)
- [**Usage:** tokens, compute, or tool calls](#usage-tokens-compute-or-tool-calls)
- [**Jobs:** a workflow, export, or conversation](#jobs-a-workflow-export-or-conversation)
- [**Outcomes:** a result both sides can check](#outcomes-a-result-both-sides-can-check)

## Who pays the model provider?

- [**Cost plus markup:** provider cost plus your fee](#provider-cost-plus-your-fee)
- [**BYOK:** the customer's key plus your app fee](#the-customers-key-plus-your-app-fee)

## How do customers buy?

- [**Credits:** show what a credit buys](#show-what-a-credit-buys)
- [**Base fee plus usage:** show what extra usage costs](#show-what-extra-usage-costs)
```

## What to charge for?

### Access: a flat fee or a price per seat

Access pricing charges a recurring fee to use your agent. You can charge a flat fee for an account or a fee for each user. Customers know the subscription price in advance, but your costs still depend on how much work the agent does.

For example, a reporting app might charge $49 a month for an agent that prepares reports, with 200 run attempts included. In the simulation, the first 199 runs cost $29.85 in compute. The last run gets stuck in a loop and pushes the total to $65, more than the subscription earns.

A limit on attempts does not control the cost of each attempt. With a disclosed $0.15 compute cap per run, the looping run stops incomplete and total compute stays at $30. That leaves $19 before other expenses. Explain that failed attempts count toward the allowance and what happens when a run reaches its cap.

For a plan priced per user, also show which users count as paid seats and require approval before adding charges. Check whether the subscription still covers your costs for customers who use the agent most.

```pricing
fixed
```

### Usage: tokens, compute, or tool calls

Usage pricing charges for the resources an agent uses. You can measure tokens, compute time, or tool calls. Customers pay more when they use more, so they need a clear rate and a way to control the bill. State how failed calls and retries count.

For example, a logistics app might use an agent to check shipment status through a paid tool. Suppose each lookup is one usage unit priced at $1, and the customer sets a $10 budget. An alert at $10 does not stop more lookups. In the simulation, work continues until the bill reaches $16.

Reserve each lookup's charge before it starts, so simultaneous requests cannot spend the same remaining balance. Settle the actual charge when it finishes and release any unused reservation. At $10, pause further work until the customer approves more spending. Enforce limits while calls run too, because provider usage reports can arrive late.

```pricing
usage
```

### Jobs: a workflow, export, or conversation

Job pricing charges for a defined piece of work. Customers can estimate their bill from the work they need, without knowing how many model calls it takes. You need to define what a job includes and when it becomes billable.

For example, an analytics app might use an agent to prepare a data export and charge $0.10 when the file is delivered. If the app loses the completion message and retries the same job, the customer should still pay $0.10 for one export. Charging when each attempt starts produces two charges for one result.

Keep the same job ID across retries and record completion before creating the charge. Set input and duration limits so one job cannot consume unlimited compute. If a conversation is your billing unit, define when it ends and when returning starts a new one. Your price also needs to cover failed attempts that do not become billable jobs.

Keep durable billing records even when you use an external meter. [Stripe's usage-recording guide](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api) explains how event identifiers and idempotency keys prevent duplicate usage reports.

```pricing
workflow
```

### Outcomes: a result both sides can check

Outcome pricing charges for an agreed result. The customer pays when the agent achieves that result, so both sides need a way to check what happened. Completing an action is not always enough to earn the charge.

For example, a support app might use an agent to help customers resolve account issues. In this example, the app charges $1 only after the customer confirms the issue is resolved. If the customer reopens it within seven days, the app reverses the charge. Closing the ticket again requires fresh confirmation before another charge.

Agree on the evidence needed to count a resolution, the dispute process, and any reversal period before work begins. Keep enough history to explain each charge. Unsuccessful attempts still cost you money, so include those costs when setting the price. The simulation shows how billing on ticket closure breaks this example's confirmation policy.

```pricing
outcome
```

## Who pays the model provider?

### Provider cost plus your fee

Cost plus markup pricing passes the provider's usage cost to the customer and adds your fee. The bill follows the cost of running the agent, so customers need to know which provider rates you use and what your fee covers.

For example, a writing app might use an agent to draft and revise product descriptions. If the model calls cost $10 and the app adds a 20% markup, the customer pays $12. The app keeps $2 before its other expenses. That is **16.7% of revenue**, not a 20% margin. A 20% margin on the same $10 cost would require a $12.50 price.

Show the provider cost and your fee separately. State whether you use list or negotiated rates and how caching, tools, and failed calls affect the bill. Save the rate used for each run so you can explain past charges when provider prices change. [Stripe's token-billing guide](https://docs.stripe.com/billing/token-billing) describes configuring markups and recording usage through Metronome.

```pricing
markup
```

### The customer's key plus your app fee

With bring your own key (BYOK), customers connect their own model-provider accounts and pay the provider directly. You charge separately for your app. This can suit customers with existing provider contracts, but they need to set up an account, payment method, and permissions before using the agent.

For example, a research app might charge $29 a month for an agent that reviews documents using the customer's provider key. If the work uses $10 of model calls, the customer's total spend is $39 across two bills. Authorizing a $10 provider budget does not create that charge. The provider bills for the usage that follows.

Show both costs before the customer starts. Protect their key, explain which account's limits apply, and ask before switching to another paying account if the first one fails. Your app fee still needs to cover storage, tools, and support, including help with provider setup and rate limits.

```pricing
byok
```

## How do customers buy?

### Show what a credit buys

Credits let customers pay for a balance and spend it as they use the agent. Different tasks can consume different amounts, so customers need to see how credits translate into useful work before they buy.

For example, a feedback-analysis app might use an agent to produce standard summaries or more detailed premium analyses. A $10 pack contains 100 credits. A standard job uses one credit, while a premium job uses ten. The pack therefore covers 100 standard jobs or ten premium jobs. In the simulation, hiding that difference makes the balance run out sooner than the customer expects.

Show the credit cost beside each job before it starts and update the remaining balance afterward. Explain expiry, rollover, and how promotional credits are used. Unused credits that expire increase what the customer paid per completed job. If you offer automatic top-ups, let the customer cap the amount spent.

```pricing
credits
```

### Show what extra usage costs

A base fee plus usage combines a subscription with a charge for work beyond an included allowance. Customers get a predictable starting price and can pay for more when they need it. They need to know both the allowance and the extra rate.

For example, an operations app might use an agent to process incoming orders. A $49 monthly plan includes 200 jobs, with each extra job costing $0.30. Processing 250 orders produces a **$64** bill: the $49 base fee plus $15 for 50 extra jobs. If serving costs average $0.15 per completed job, including failed attempts, the work costs $37.50 and leaves $26.50 before other expenses.

Show the extra $15 before the customer approves the additional work. State when the allowance resets, whether unused jobs roll over, and whether work pauses when it runs out. Limit expensive individual runs too. A predictable customer bill does not guarantee predictable costs for your app.

```pricing
hybrid
```

## Test the bill before changing your plans

Before choosing a model, show customers what the same workload would cost under different plans. Ask which bill they can budget for and who would approve extra spending. Compare their answers with the full cost of serving that workload.

For the finance app introduced earlier, take a month of invoice follow-ups and prepare two sample bills: one with a subscription and one charged per follow-up. Include reminders that did not lead to payment. Ask the customer to explain each bill back to you and check whether the rates and limits are clear.

Count failures, retries, tools, support, and human review in your costs. During a pilot, measure adoption, margin, and retention. If a plan includes a spending commitment, explain expiry, rollover, renewal, and charges above the commitment. If rates change with volume, state whether each tier applies to all usage or only the units within that band.

## Put the limits where the work happens

A pricing plan needs controls where customers start and monitor the work. Show the estimate, rate, and paying account before the agent begins. Keep **spent**, **reserved**, and **remaining** amounts separate so work already in progress is included in the available budget.

In the finance app, the customer should see the estimated cost before starting another batch of invoice reminders. Reserve its budget before sending any reminders, then settle the actual usage and release the rest. If several batches run together, they must share the same account limit. Opening a new chat should not create a fresh spending allowance.

Explain what happens at zero and how you handle calls already running. Check the [timing of provider spending controls](https://vercel.com/docs/spend-management) and [which resources they cover](https://docs.snowflake.com/en/user-guide/resource-monitors) before describing a limit as hard. Test simultaneous jobs, late usage reports, failed cancellation, and an empty balance.

Keep a receipt with the job ID, billable event, quantity, rate version, allowance, and adjustments. Before the agent tries again, you and the customer should know what you will charge whether the invoice gets paid or stays unpaid.

## Try it in your app

Use [AstralBeam](/) to add an agent to your app. We handle the agent backend and conversation history, while you connect the tools for your use case.

For the finance app, connect tools that read invoice records, send reminders, and check payment status. Let users work with their files, set a customer allowance, and track model spend as the agent follows up.

[Try AstralBeam on Cloud](/auth/sign-up), follow the [quickstart](/docs/start/quickstart), or [tell us what you're building](mailto:hello@astralbeam.ai) and how you'd charge for it.
