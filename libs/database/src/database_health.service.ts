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
    console.log('🔌 Testing database connection...');
    console.log('Database config:', {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
    });

    const alive = await this.isAlive();
    if (alive) {
      console.log('✅ Database connection successful!');
    } else {
      console.error('❌ Database connection failed.');
    }
  }

  // Health-check liveness — dùng lại ở đây (boot log) LẪN từ bên ngoài (VD
  // HealthCheckService của orchestration) thay vì mỗi nơi tự viết 1 câu SELECT 1 riêng.
  async isAlive(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1 as test');
      return true;
    } catch (error: unknown) {
      if (isError(error)) {
        console.error('Database health check failed:', error.message);
      } else {
        console.error('Database health check failed:', error);
      }
      return false;
    }
  }
}
