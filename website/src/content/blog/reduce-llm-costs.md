---
title: "Lower LLM Costs by Giving Your Agent Less Work"
description: "Pick the right model, stop sending unused data, and reuse work. Where to start when you're adding an agent to your SaaS."
date: "2026-11-10"
author: "AstralBeam team"
image: "/blog/images/llm-costs.png"
imageAlt: "An agent filters data and reuses earlier work before sending the model what it needs."
---

“Which invoices are overdue?” needs a short answer. Downloading every invoice and carrying them into later turns makes it expensive.

For a customer-facing SaaS agent, start with models, repeated context, and tool responses. Add customer limits early. The order below balances savings and effort for a small team. Start with batching if background jobs dominate your bill.

Press **Start** to compare approaches. Like our [chat interface field guide](/blog/ten-agentic-chat-interface-failures), these demos are illustrative simulations, not benchmarks.

## Check what a completed task costs

Measure **total spend across all attempts ÷ successfully completed tasks**. A smaller bill means little if fewer tasks succeed.

In one [coding-agent study](https://arxiv.org/abs/2607.12161v5), compression cut tool-output tokens **38.4%** while billed cost rose **6.8%**. Extra work and cache traffic outweighed smaller payloads.

Compare the same tasks and model versions. Track quality, latency, retries, tool fees, sandbox fees, and storage. Separate uncached input, cache writes, reads, and output without double-counting reasoning. Test fresh and populated caches. Savings overlap, so don't add percentages.

## 1. Choose the model and response your task needs

Test cheaper models on real requests, including tool calls and permissions. [OpenAI's cost guide](https://developers.openai.com/api/docs/guides/cost-optimization) covers model choice. Ask for the fields your app needs instead of paragraphs it discards, following its [latency guide](https://developers.openai.com/api/docs/guides/latency-optimization).

Try lower reasoning effort too. The [Responses API's output cap](https://developers.openai.com/api/docs/guides/reasoning) includes reasoning, visible output, and non-visible formatting. Too low can produce incomplete answers and retries.

```cost-demo
output
```

A router picks a model for each task. A cascade tries a cheaper model, then escalates rejected results. [RouteLLM](https://arxiv.org/abs/2406.18665) studies the tradeoff between cost and quality. Verify fields, IDs, and amounts against sources. Valid JSON and self-reported confidence aren't enough. Count validation and both attempts. [Switching models mid-conversation](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything) can also require rebuilding the cache.

```cost-demo
routing
```

## 2. Reuse the context that stays the same

Put stable instructions and ordered tool definitions first, changing questions and metadata last. Check [Claude's prerequisites](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and [OpenAI's eligibility rules](https://developers.openai.com/api/docs/guides/prompt-caching) for minimum prefixes, expiry, and settings. Claude requires `cache_control`.

Writes can carry a premium. Check that savings from later reads cover the higher write cost. Cached content still occupies context, and answers still cost money. [Manus's lessons](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) explain how earlier input changes break reuse.

```cost-demo
caching
```

## 3. Send only the data the agent needs

Fetch overdue invoices for the permitted customer, returning IDs, dates, and amounts. Let the database calculate totals.

Use filters, field selection, pagination, and limits. Keep follow-up IDs and a way to fetch details. Return relevant document passages with sources. [Anthropic's tool guide](https://www.anthropic.com/research/writing-tools-for-agents) covers this approach. Count retrieval fees and extra calls caused by missing fields.

```cost-demo
retrieval
```

## 4. Put limits around each customer's usage

Limit spend per customer, user, or conversation, plus turns, tools, duration, and retries.

Before paid calls, check that a conservative estimate fits the budget and reserve it. Make this atomic across workers so they can't spend the same remainder twice. Reconcile when final usage arrives, keeping uncertain charges reserved. [OpenAI's spending controller](https://developers.openai.com/cookbook/articles/per_run_spending_controller_responses_api) shows how.

[Turn limits](https://openai.github.io/openai-agents-python/running_agents/) don't cap tool fees or duration. Account for SDK retries. Stop repeated failures and save progress. After a lost action response, use its stable operation ID to check whether it already happened before retrying.

Use code for arithmetic and [workflows for known sequences](https://www.anthropic.com/research/building-effective-agents). Estimates cannot guarantee an exact bill.

```cost-demo
budgets
```

## 5. Batch the work that can wait

Ticket tagging, daily summaries, and evaluations can often wait. [OpenAI Batch](https://developers.openai.com/api/docs/guides/batch) and [Claude Message Batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing) discount eligible processing **50%** through their batch APIs, with **24-hour** windows. Combining questions in one prompt doesn't qualify.

Save request IDs, input versions, and outcomes. Reconcile partial successes and retry only appropriate failures. Expired batches can contain billable successes. Count other fees separately. Claude's batch cache hits are best-effort because processing is asynchronous and concurrent.

```cost-demo
batching
```

## 6. Use Code Mode for bulk work

In Code Mode, the model writes a program that processes data in a sandbox. It can total invoice pages while keeping the rows out of the conversation. Keep source IDs or saved rows for checking. [Anthropic's MCP example](https://www.anthropic.com/research/code-execution-with-mcp) also loads tools as needed. [Cloudflare reports](https://blog.cloudflare.com/code-mode-mcp/) roughly **1,000 tokens** of initial tool definitions, not whole-task cost. The [Hacker News discussion](https://news.ycombinator.com/item?id=45386248) connects the idea to earlier code-action research.

Count sandbox fees and failed attempts. Restrict access and runtime, and preserve tool approval requirements. Keep simple lookups direct.

```cost-demo
code-mode
```

## 7. Summarize completed work in long conversations

[Compaction](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) replaces older history with summaries. Keep recent messages intact and reserve room for next input, tool results, output, and summarization below the context limit.

Keep the goal, constraints, decisions, completed actions, unfinished work, exact IDs, and evidence. Preserve tool call/result pairs and pending approvals. Resume from the summary and check the next action: “waiting for refund approval” must not become “refund approved.”

Count summarization and recovery searches. Replacing cached history can trigger [new cache writes](https://platform.claude.com/docs/en/build-with-claude/context-editing), outweighing savings.

```cost-demo
compaction
```

## 8. Cache answers when reuse is safe

Response caching skips generation. Key exact reuse by relevant history, source versions, model, prompt, settings, and permissions.

A [Reddit report](https://www.reddit.com/r/LangChain/comments/1vddzjv/semantic_caching_quietly_serving_wrong_answers/) describes confusing “pause” with “cancel”, an anecdote rather than an error rate. [GPTCache](https://github.com/zilliztech/GPTCache) demonstrates embedding-based reuse. A [five-workload study](https://arxiv.org/abs/2611.01077v2) found similarity poorly predicted acceptable multi-turn reuse.

Keep organizations, customer accounts (tenants), and users separate. Recheck current permissions, expire entries, and invalidate them when relevant data changes. A cached action result doesn't prove an action just ran.

Test near matches and different histories. Count lookup, embeddings, storage, invalidation, and verifier-model fees.

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

Its [own guidance](https://github.com/toon-format/toon#when-not-to-use-toon) says compact JSON can beat it on irregular objects, CSV is smaller for tables, and some local or quantized models process JSON faster.

[Apify's MCP team removed TOON](https://aaif.io/blog/we-added-toon-to-our-mcp-server-then-removed-it) after 30 days and two A/B rounds. Its September encoder rerun used **11.7% more tokens** than compact JSON for 100 Google Maps places, specific to those payloads and versions. [Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1oylf8m/stopping_the_toon_hype_with_a_proper_benchmark/) and [Hacker News](https://news.ycombinator.com/item?id=45715632) discussions question benchmark baselines.

Remove unused fields first. Compare actual tokens, including instructions, accuracy, and latency over repeated runs weighted by traffic.

```cost-demo
toon
```

## Try it in your app

Start with your customers' most common task. Change one thing, then compare cost per successful completion and latency.

[AstralBeam](/home) gives you a chat sidebar and managed backend. Connect your app's tools, work with files in a coding sandbox, track model spend, and set limits per customer, user, or conversation. Keep your authentication and permissions. Use AstralBeam Cloud or self-host.

**Cost-control preview:** This guide includes controls we want to make easier. Tell us where your agent spends too much.

**[Try AstralBeam](/auth/sign-up)** · [Tell us which cost controls you need](mailto:hello@astralbeam.ai?subject=LLM%20cost%20controls)
