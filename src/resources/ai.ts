import type { BaseClient } from "../client";
import type { GenerateTextInput, GenerateTextResult } from "../types/ai";
import type { ApiResponse } from "../types/common";

/** Generate text with the workspace's configured LLM. */
export class AI {
  constructor(private client: BaseClient) {}

  /**
   * Generate text from a prompt using the workspace's configured model
   * (OpenRouter-backed, default `anthropic/claude-sonnet-4`). The workspace
   * brand context and skills are applied as the system prompt unless disabled,
   * and usage is metered against the workspace AI budget.
   *
   * @example
   * ```ts
   * const { data } = await medal.ai.generate({
   *   prompt: "Write a 3-bullet market summary.",
   *   system_prompt: "You are a precise market analyst.",
   *   max_tokens: 400,
   *   use_brand_context: false,
   * });
   * console.log(data.text, data.model, data.usage.output_tokens);
   * ```
   */
  async generate(input: GenerateTextInput): Promise<ApiResponse<GenerateTextResult>> {
    return this.client.post("/api/v1/ai/generate", input);
  }
}
