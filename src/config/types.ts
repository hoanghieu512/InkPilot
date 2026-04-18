export interface Config {
  anthropicApiKey: string;
  dbPath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
