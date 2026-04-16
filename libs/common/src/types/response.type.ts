export interface IBaseResponse<T> {
  status: 'Success' | 'Error';
  statusCode: number;
  code?: string;
  data: T;
  message: string;
  metadata: {
    timestamp: string;
    path: string;
    method: string;
  };
}

export interface IOffsetResponse<T> extends IBaseResponse<T> {
  paging: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
