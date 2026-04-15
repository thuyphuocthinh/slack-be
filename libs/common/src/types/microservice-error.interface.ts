export interface IMicroserviceError {
  statusCode?: number;
  status?: number;
  message?: string | string[];
  name?: string;
  error?: string;
  code?: string;
  response?: IMicroserviceError;
}
