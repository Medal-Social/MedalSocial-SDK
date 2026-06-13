/** Input for generating text with the workspace's configured LLM. */
export interface GenerateTextInput {
  /**
   * The prompt to send to the model. Supports `{{placeholder}}` substitution
   * when `variables` is provided; otherwise it is sent verbatim.
   */
  prompt: string;
  /**
   * Model id in `provider/model` form (e.g. `anthropic/claude-sonnet-4`).
   * Defaults to the workspace's selected model.
   */
  model?: string;
  /**
   * Override the system prompt. When omitted, the workspace brand context is
   * used as the system prompt (unless `use_brand_context` is `false`).
   */
  system_prompt?: string;
  /** Sampling temperature, 0–2. Defaults to the workspace setting. */
  temperature?: number;
  /** Maximum number of tokens to generate (32–4096). */
  max_tokens?: number;
  /**
   * Prepend the workspace brand document, guidelines and skills as system
   * context. Defaults to `true`. Ignored when `system_prompt` is set.
   */
  use_brand_context?: boolean;
  /** Include workspace skills in the brand context. Defaults to `true`. */
  use_skills?: boolean;
  /** Values substituted into `{{placeholder}}` tokens in the prompt. */
  variables?: Record<string, string>;
}

/** Result of a text generation request. */
export interface GenerateTextResult {
  /** The generated text. */
  text: string;
  /** The model that produced the text (`provider/model`). */
  model: string;
  /** Token usage for the request. */
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
