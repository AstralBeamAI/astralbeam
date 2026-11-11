---
title: "Lower LLM Costs by Giving Your Agent Less Work"
description: "Pick the right model, stop sending unused data, and reuse work. Where to start when you're adding an agent to your SaaS."
date: "2026-11-10"
author: "AstralBeam team"
image: "/blog/images/llm-costs.png"
imageAlt: "An agent filters data and reuses earlier work before sending the model what it needs."
---

A user asks, “Which invoices are overdue?” Your agent downloads every invoice, reads fields it never uses, and carries the results into the next turn. The answer takes one line. The bill includes all the work behind it.

If you're adding an agent to your SaaS, we'd start with the model, repeated context, and tool responses. These are the first places to check before adding more infrastructure. Put customer usage limits in early too.

The order below weighs likely savings against the work involved for a small team running a customer-facing agent. Your traffic decides the actual priority. If most of your bill comes from background jobs, start with batching.

Press **Start** in each demo to compare approaches. Like our [chat interface field guide](/blog/ten-agentic-chat-interface-failures), these are illustrative simulations, not savings benchmarks.

## Check what a completed task costs

For an in-app agent, success means giving the right answer or completing the allowed action. Count all the attempts it took to get there:

**Total spend across all attempts ÷ successfully completed tasks.**

Spending $10 to finish 90 tasks costs about 11.1 cents each. Spending $9 to finish 75 costs 12 cents each. The smaller bill is buying less useful work.

A [controlled coding-agent study](https://arxiv.org/abs/2607.12161v5) found the same trap: its largest compression setup removed **38.4% of delivered tool-output tokens while billed cost rose 6.8%**. Cache traffic and extra agent work outweighed the smaller payloads. That's a result from one tested setup, not a prediction for your app.

Use the same tasks and model versions for comparisons. Record quality, latency, retries, tool and sandbox fees, and storage. Break spend down by customer and task type. Keep uncached input, cache writes, reads, and output separate, following the provider's definitions so reasoning is not counted twice. Test with both fresh and already-populated caches. Savings from different techniques overlap, so don't add their percentages together.

## 1. Choose the model and response your task needs

Try a cheaper model on real requests from your app. Check its answers, tool calls, and permission handling before changing the default. A ticket classifier and a difficult investigation may need different models. [OpenAI's cost guide](https://developers.openai.com/api/docs/guides/cost-optimization) includes model choice alongside reducing requests and tokens.

Keep the response useful and short. A background classifier may only need a category and priority. Ask for those fields instead of paragraphs your app throws away. A reply to a user still needs to explain the result and any next step. [OpenAI's latency guide](https://developers.openai.com/api/docs/guides/latency-optimization) covers reducing generated tokens.

Test lower reasoning effort on routine work too. In OpenAI's Responses API, `max_output_tokens` covers reasoning, visible output, and non-visible formatting. A low cap can run out before the answer appears or leave you with incomplete JSON. Count those retries. See the [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).

```cost-demo
output
```

If different tasks need different models, you can add a router. A cascade tries a cheaper model first, then escalates rejected results. [RouteLLM](https://arxiv.org/abs/2406.18665) studies that tradeoff. Check required fields, IDs, and amounts against the source, and test accepted answers on separate examples. Valid JSON and the model saying it is confident aren't enough.

Include routing, validation, and escalation costs. If most requests escalate, you pay for both attempts. The [Claude Code team's caching lessons](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything) also show why switching an existing conversation to a cheaper model can cost more when it has to rebuild the cache.

```cost-demo
routing
```

## 2. Reuse the context that stays the same

Your instructions, tool definitions, and product manual may be repeated on every call. Put that stable content first. Keep tools in the same order. Put the new question and changing metadata last. A timestamp at the front can break reuse of everything after it.

Check the selected model's minimum prefix length, expiry, and required settings. Claude's Messages API needs `cache_control` even for automatic caching. The [Claude prerequisites](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and [OpenAI eligibility rules](https://developers.openai.com/api/docs/guides/prompt-caching) explain the differences.

Cache writes can cost more than ordinary input. Later reads need to make that back. Check billed reads and writes before claiming savings. You're still paying to generate each answer, and cached content still occupies the context window. The benefit depends on how much input repeats and how often it can be reused. [Manus's production lessons](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) cover how changes to earlier tools or input formatting can break the match.

```cost-demo
caching
```

## 3. Send only the data the agent needs

Replace “list every invoice” with “find this customer's overdue USD invoices, returning ID, due date, and amount.” Apply your normal permission checks. If the question asks for a total, let the database calculate it.

Give tools filters, field selection, pagination, and result limits. Keep the IDs needed for follow-up actions and a way to fetch more detail. For documents, return relevant passages with sources and remove duplicates. [Anthropic's tool design guide](https://www.anthropic.com/research/writing-tools-for-agents) explains this approach.

This is worth checking when your tool responses are large. Watch what happens next: if the agent keeps asking for fields you removed, the smaller response may create more calls. Include retrieval and reranking fees in the comparison.

```cost-demo
retrieval
```

## 4. Put limits around each customer's usage

One customer's long-running task shouldn't consume your whole allowance. Set limits per customer, user, or conversation, plus limits on turns, tool calls, elapsed time, and retries.

Before a paid call, check that a conservative estimate fits the remaining budget and reserve it. When final usage arrives, replace that reservation with the reported cost. If several workers share a budget, make the check and reservation one atomic operation so they can't spend the same remainder twice. [OpenAI's spending-controller example](https://developers.openai.com/cookbook/articles/per_run_spending_controller_responses_api) covers this, including uncertain charges.

A [maximum-turn limit](https://openai.github.io/openai-agents-python/running_agents/) alone cannot cap external tool fees or duration. Check SDK retries before adding your own retry loop. Stop repeated equivalent failures and save progress. If an action's response was lost, use a stable operation ID to check whether it already happened before retrying.

Use ordinary code for validation and arithmetic. A known sequence may work better as a workflow, as [Anthropic's architecture guide](https://www.anthropic.com/research/building-effective-agents) explains. Limits cut wasted calls. Estimates still need reconciliation, so they don't guarantee an exact final bill.

```cost-demo
budgets
```

## 5. Batch the work that can wait

Ticket tagging, daily summaries, and offline evaluations don't always need a live response. [OpenAI's Batch API](https://developers.openai.com/api/docs/guides/batch) and [Claude's Message Batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing) offer 50% discounts on eligible processing. You need to use the Batch API to get that rate. Putting several questions into one prompt does not qualify.

Both document 24-hour processing windows and expired requests. Save each request ID, input version, and outcome. Match results back to requests and reconcile successes, failures, and missing results. An expired batch can still contain completed, billable work. If three of 1,000 items fail, repair or retry those three where appropriate. Keep the 997 successes, and check answer quality before marking work complete.

The discount applies to eligible processing. Suppose 40% of your model spend can move to batch. Halving that portion saves 20% of model spend before retries or other changes. That's illustrative arithmetic, not a forecast. Account for tool and storage fees separately. Check combined caching rules too: Claude says batch cache hits are best-effort because requests run asynchronously and concurrently.

```cost-demo
batching
```

## 6. Use Code Mode for bulk work

Once a task needs many pages of data or several calculations, returning everything to the model gets expensive. Code Mode lets the model write a program that does the intermediate work outside the conversation. Against an imaginary invoice SDK:

```typescript
let totalMinor = 0
for await (const page of invoices.pages({ status: "overdue", currency: "USD" })) {
  totalMinor += page.reduce((sum, invoice) => sum + invoice.totalMinor, 0)
}
console.log({ currency: "USD", totalMinor })
```

The pages stay in the sandbox and only the total reaches the model. Keep source IDs or a saved result file when you need to check it. [Anthropic's MCP example](https://www.anthropic.com/research/code-execution-with-mcp) combines this with loading tool definitions when needed. [Cloudflare's implementation](https://blog.cloudflare.com/code-mode-mcp/) uses roughly **1,000 tokens of tool definitions**. That's its initial tool footprint, not the cost of a whole task. The [Hacker News discussion](https://news.ycombinator.com/item?id=45386248) links the idea to earlier code-action research.

This makes sense when it replaces large intermediate results or several model turns. Count failed attempts and sandbox fees. Restrict access and runtime, and keep the same approval requirements as direct tool calls. A simple lookup can stay a direct call.

```cost-demo
code-mode
```

## 7. Summarize completed work in long conversations

After the agent totals the overdue invoices, it can keep the total, exact invoice IDs, and a link to the saved rows. Carrying every search result into the next question adds work.

Compaction replaces older history with a summary. Keep recent messages in full. [Anthropic's context guide](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) also covers clearing material you can fetch again and keeping notes outside the active window.

Leave enough room for the next step:

```text
current context + next input + expected tool results + reserved output
```

Set a working budget below the model's limit and check whether that next step will fit. Allow for the summary call too. A completed task is a useful place to compact.

Keep the goal, constraints, decisions, completed actions, and unfinished work. Preserve exact IDs and links to evidence. Keep active tool calls with their results, and leave pending approvals pending. A summary that turns “waiting for refund approval” into “refund approved” changes what the agent is allowed to do. Resume from the summary on your test tasks and check its next actions.

Count the summary call and any searches needed to recover missing details. Replacing cheap cached history can also create a new cache write. Those costs can outweigh the smaller context. See [Claude's cache invalidation rules](https://platform.claude.com/docs/en/build-with-claude/context-editing).

```cost-demo
compaction
```

## 8. Cache answers when reuse is safe

Prompt caching still generates an answer. A response cache can skip that call. Start with exact reuse, keyed by relevant conversation history, source versions, model, prompt, generation settings, and permissions.

Similar wording can mean something different. A [Reddit report](https://www.reddit.com/r/LangChain/comments/1vddzjv/semantic_caching_quietly_serving_wrong_answers/) describes a cached “pause my subscription” answer being returned for “cancel my subscription.” It's an anecdote, not a general error rate. [GPTCache](https://github.com/zilliztech/GPTCache) shows how reuse through embeddings works. A [multi-turn caching study](https://arxiv.org/abs/2611.01077v2) found similarity poorly predicted acceptable reuse across its five workloads.

Keep organizations, customer accounts (tenants), and users separate. Recheck current permissions, expire entries, and invalidate them when relevant data changes. A cached action result is not proof that an action just ran.

A correct hit avoids generation. Your net saving depends on which calls you skip, how often reuse is correct, and the cost of lookup, embeddings, verification, storage, and invalidation. Test confusing near matches and different conversation histories. If another model verifies the hit, count that call too.

```cost-demo
answer-cache
```

## 9. Test TOON after fixing the payload

TOON, or Token-Oriented Object Notation, declares shared keys once for uniform rows:

```text
invoices[2]{id,status,total}:
  inv_01,overdue,120
  inv_02,paid,80
```

It can reduce repeated structure. But the [project's own guidance](https://github.com/toon-format/toon#when-not-to-use-toon) says compact JSON can win for nested or irregular objects, CSV is smaller for purely tabular data, and some local or quantized models process JSON faster despite higher token counts. Keep your API contracts and test the format where data enters the model.

Apify's MCP team [removed TOON after a 30-day deployment and two A/B testing rounds](https://aaif.io/blog/we-added-toon-to-our-mcp-server-then-removed-it) found no consistent benefit. A September rerun of its encoder test used **11.7% more tokens** for 100 Google Maps places than compact JSON. That result is specific to those payloads and encoder versions. The [Reddit critique](https://www.reddit.com/r/LocalLLaMA/comments/1oylf8m/stopping_the_toon_hype_with_a_proper_benchmark/) and [Hacker News discussion](https://news.ycombinator.com/item?id=45715632) also question baselines and benchmark reliability.

Count actual tokens, including format instructions. Check accuracy and latency over repeated runs, and weight the results by real traffic. Smaller payloads won't move the bill much if they account for little spend. Remove unused fields before testing another encoding.

```cost-demo
toon
```

## Start with the task your customers run most

Pick one job your customers already use. If it's ticket tagging, compare models on the same tickets. If it's answering invoice questions, check the amounts, IDs, and follow-up actions too. Record cost per completed task and how long it takes. Try one change, check the result, then move to the next. Keep the changes that save money without making your users fix the agent's work.

## Try it in your app

[AstralBeam](/home) gives you an agentic chat sidebar and managed backend. Connect your app's tools, work with files in a coding sandbox, track token usage and model spend, and set limits per customer, user, or conversation. Keep your authentication and permission checks. Use AstralBeam Cloud or self-host.

**Cost-control preview:** This guide also covers controls we want to make easier in AstralBeam. Try the platform and tell us where your agent spends too much.

**[Try AstralBeam](/auth/sign-up)** · [Tell us which cost controls you need](mailto:hello@astralbeam.ai?subject=LLM%20cost%20controls)
