import type { Pool } from 'pg';
import type {
  CreateMcpServer,
  McpServer,
  ServerRepository,
  UpdateMcpServer,
} from './types.js';

type ServerRow = {
  id: string;
  name: string;
  endpoint: string;
  transport_type: 'streamable_http';
  enabled: boolean;
  check_interval_seconds: number;
  created_at: Date;
  updated_at: Date;
};

const toServer = (row: ServerRow): McpServer => ({
  id: row.id,
  name: row.name,
  endpoint: row.endpoint,
  transportType: row.transport_type,
  enabled: row.enabled,
  checkIntervalSeconds: row.check_interval_seconds,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export class PostgresServerRepository implements ServerRepository {
  constructor(private readonly pool: Pool) {}

  async list() {
    const result = await this.pool.query<ServerRow>(
      'SELECT * FROM mcp_servers ORDER BY created_at DESC',
    );
    return result.rows.map(toServer);
  }

  async findById(id: string) {
    const result = await this.pool.query<ServerRow>(
      'SELECT * FROM mcp_servers WHERE id = $1',
      [id],
    );
    return result.rows[0] ? toServer(result.rows[0]) : null;
  }

  async create(input: CreateMcpServer) {
    const result = await this.pool.query<ServerRow>(
      `INSERT INTO mcp_servers (name, endpoint, transport_type, enabled, check_interval_seconds)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        input.name,
        input.endpoint,
        input.transportType,
        input.enabled,
        input.checkIntervalSeconds,
      ],
    );
    return toServer(result.rows[0]);
  }

  async update(id: string, input: UpdateMcpServer) {
    const result = await this.pool.query<ServerRow>(
      `UPDATE mcp_servers
       SET name = COALESCE($2, name), endpoint = COALESCE($3, endpoint),
           transport_type = COALESCE($4, transport_type), enabled = COALESCE($5, enabled),
           check_interval_seconds = COALESCE($6, check_interval_seconds), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        id,
        input.name,
        input.endpoint,
        input.transportType,
        input.enabled,
        input.checkIntervalSeconds,
      ],
    );
    return result.rows[0] ? toServer(result.rows[0]) : null;
  }

  async delete(id: string) {
    const result = await this.pool.query(
      'DELETE FROM mcp_servers WHERE id = $1',
      [id],
    );
    return result.rowCount === 1;
  }
}
