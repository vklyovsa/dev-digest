export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export type ApiErrorKind = 'unreachable' | 'timeout' | 'aborted' | 'http' | 'shape';

export interface ApiErrorInit {
  method: string;
  path: string;
  message: string;
  status?: number;
  code?: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly method: string;
  readonly path: string;
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(kind: ApiErrorKind, init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = kind;
    this.method = init.method;
    this.path = init.path;
    this.status = init.status;
    this.code = init.code;
  }
}
