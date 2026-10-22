export type TransportType = 'streamable_http';

export type McpServer = {
  id: string;
  name: string;
  endpoint: string;
  transportType: TransportType;
  enabled: boolean;
  checkIntervalSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateMcpServer = Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateMcpServer = Partial<CreateMcpServer>;

export interface ServerRepository {
  list(): Promise<McpServer[]>;
  findById(id: string): Promise<McpServer | null>;
  create(input: CreateMcpServer): Promise<McpServer>;
  update(id: string, input: UpdateMcpServer): Promise<McpServer | null>;
  delete(id: string): Promise<boolean>;
}
