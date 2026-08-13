<p align="center">
  <img src="https://img.shields.io/badge/NestJS-microservices-E0234E?logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-BullMQ-DC382D?logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey" alt="License" />
</p>

<h1 align="center">Slack Clone + Agent OS</h1>
<p align="center">
  A production-shaped Slack clone (15 NestJS microservices) with a built-in <b>multi-agent AI orchestration layer</b> —
  a Supervisor/ReAct agent that plans, delegates to tool-using sub-agents across 10+ real external systems
  (SQL Server, GitHub, Google Workspace, Notion, Slack itself, arbitrary Swagger/OpenAPI APIs), and asks for
  human approval before any destructive action.
</p>

> **Status**: personal portfolio project, not a commercial product. Built to demonstrate distributed-systems and
> AI-agent engineering practices end-to-end — real load testing, real failure-mode testing, real fixes with
> before/after evidence (see [`slack-docs`](../slack-docs) for the full test logs). Not seeking to monetize.

---

## Why this project exists

Most "AI chatbot" side projects wire one LLM call to one tool and call it done. This one tries to answer a harder
question: **what does an AI agent layer look like once you stop trusting it by default?**

- What happens when the model asks to delete data — does it wait for a human, or does it just do it?
- What happens when the same destructive step gets planned twice in one turn — does it run twice?
- What happens when the model *says* "done, 12/12" but only 6 tool calls actually succeeded?
- What happens when 300 people click send at the same second?

This repo is where those questions get asked against a real running system, not a diagram. See
[`manual_test_bank_heavy.md`](../slack-docs/docs/Documents/Orchestration/manual_test_bank_heavy.md) and
[`manual_test_bank_load.md`](../slack-docs/docs/Documents/Orchestration/manual_test_bank_load.md) for the actual
test runs, real bugs found, root causes, and fixes.

## What's in the box

A full team-chat product (channels, DMs, threads, file sharing, collaborative docs, video calls, calendar,
billing) — **plus** an AI teammate you can `@mention` in any channel that can actually go do things:

| Area | What it does |
|---|---|
| **Messaging** | Channels, DMs, threads, reactions, mentions, rich text (Tiptap), file attachments |
| **Agent OS (Orchestration)** | Supervisor plans multi-step tasks → delegates to a ReAct loop per agent → synthesizes one final answer. Approval gate (HITL) before any write/delete. Circuit breakers per LLM/tool provider. Checkpoint/resume across restarts. |
| **Integrations** | SQL Server, GitHub, Google Sheets/Docs/Drive/Calendar/Gmail, Notion, Slack, a Python sandbox for compute, and **any REST API via a Swagger/OpenAPI spec** — connect a new system without writing a new agent |
| **Collaborative docs (Canvas)** | Real-time multi-cursor editing via Yjs + Hocuspocus |
| **Video calls** | LiveKit-based rooms |
| **Workspaces & permissions** | Multi-workspace, roles, invites, SSO scaffolding |
| **Billing** | Stripe subscriptions |
| **Notifications** | Email (SendGrid/SMTP + Handlebars templates), in-app, push |

## Architecture

15 independent NestJS microservices, each its own deployable process, talking over TCP (`@nestjs/microservices`)
for request/response and BullMQ (Redis) for async work — no shared in-process state between services.

```
Client → api-gateway (HTTP+WS) ──TCP──▶ auth · user · workspace · channel · message
                                        task · billing · calendar · integrations
                                        notification · video-call · canvas
                                        orchestration ("Agent OS")
                          ▲
                     socket-gateway (Socket.IO, Redis adapter — realtime fan-out)
```

Full breakdown of the orchestration engine (Supervisor/ReAct loop, tool dedupe, quantity-honesty checks,
approval flow, checkpoint/resume, circuit breakers) is in **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## Tech stack

| Layer | Choices |
|---|---|
| Framework | NestJS (TCP microservices + BullMQ workers) |
| Database | PostgreSQL + `pgvector` (semantic memory search), TypeORM |
| Cache / Queue | Redis (`ioredis`), BullMQ, Socket.IO Redis adapter |
| AI providers | OpenAI, Anthropic, Google Gemini — behind a provider-agnostic `LlmStrategy` interface, routed through a self-hosted [9router](https://github.com/) gateway |
| Agent protocol | [Model Context Protocol](https://modelcontextprotocol.io) (MCP) for tool calling |
| Realtime | Socket.IO, Yjs + Hocuspocus (CRDT collaborative editing) |
| Video | LiveKit |
| Auth | Passport (JWT + Google OAuth2), Argon2, TOTP (Speakeasy) |
| Payments | Stripe |
| Observability | Winston + Grafana Loki, Prometheus (`prom-client`) |
| Load testing | k6, custom bulk-user-seeding scripts (bypass rate limits by writing straight to Postgres + self-signed JWTs) |

## Getting started

```bash
pnpm install

# infra: Postgres (+pgvector) / Redis (cache + BullMQ) / LLM router
docker compose -f docker-compose.dev.yml up -d

# copy env and fill in provider keys (OpenAI/Anthropic/Google, Stripe, etc.)
cp .env.example .env

# run everything (dev, hot-reload)
pnpm start:all

# or one service at a time
pnpm start:orchestration
```

```bash
pnpm test          # unit tests (Jest) — 800+ specs
pnpm test:cov       # coverage
pnpm type-check     # tsc --noEmit across the whole workspace
```

## Project layout

```
apps/            15 microservices — 1 folder per deployable service
libs/
  common/        cross-cutting: exception filters, guards, decorators
  constants/     shared enums, prompts, DTOs, magic numbers (one source of truth)
  database/      TypeORM data-source config
  queue/         BullMQ module (queue names, default job options)
  cached/        Redis-backed cache services (auth token version, etc.)
loadtest/        k6 scripts + Node bulk-seeding scripts for scale testing
docs/            architecture notes
```

## A note on how this was built

Built solo with heavy, deliberate use of AI pair-programming (Claude Code) — but every fix in the test logs
followed the same loop: **reproduce with a real request → read the actual code to find the real root cause →
propose a fix → implement → re-verify against a live running system, not just "looks right."** The value add
wasn't typing the code; it was deciding what to test, catching when an AI-proposed root cause was wrong (it
happened, and it's documented when it did), and knowing when a fix was actually done versus just looked done.
