---
"@medalsocial/sdk": minor
---

Add `medal.ai.generate()` for workspace LLM text generation via `POST /api/v1/ai/generate`. Backed by the workspace's configured model (OpenRouter, default `anthropic/claude-sonnet-4`) with optional brand context, skills, `{{placeholder}}` variables, temperature and max-token controls. Usage is metered against the workspace AI budget.
