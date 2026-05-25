import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { getDataSourceOptions } from './libs/database/src/database.config';

// Load environment variables for the CLI
dotenv.config();

export const AppDataSource = new DataSource(getDataSourceOptions());
