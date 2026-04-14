import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isError } from '@slack/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthService implements OnModuleInit {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      console.log('🔌 Testing database connection...');
      console.log('Database config:', {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
      });

      // Test connection
      await this.dataSource.query('SELECT 1 as test');
      console.log('✅ Database connection successful!');
    } catch (error: unknown) {
      if (isError(error)) {
        console.error('❌ Database connection failed:', error.message);
        console.error('Full error:', error);
      } else {
        console.error('❌ Database connection failed:', error);
      }
    }
  }
}
