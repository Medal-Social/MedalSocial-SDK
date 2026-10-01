import type { BaseClient } from "../client";
import type { ApiResponse } from "../types/common";
import type { Workspace } from "../types/workspaces";

/** Access workspaces for the authenticated credential. */
export class Workspaces {
  constructor(private client: BaseClient) {}

  /** List workspaces accessible to the current API key or OAuth token. */
  async list(): Promise<ApiResponse<Workspace[]>> {
    return this.client.get("/api/v1/me/workspaces");
  }
}
