export interface IMicroserviceError {
  statusCode?: number;
  status?: number;
  message?: string | string[];
  name?: string;
  error?: string;
  response?: IMicroserviceError;
}
