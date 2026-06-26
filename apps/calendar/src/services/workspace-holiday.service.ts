import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import Holidays from 'date-holidays';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { WorkspaceHolidayEntity } from '../entity/workspace_holiday.entity';
import { CALENDAR_ERROR, SYSTEM_ERRORS } from '@slack/constants';
import { CACHE, TTL } from '@slack/cached/cached.constant';
import { CachedService } from '@slack/cached/cached.service';
import { plainToInstance } from 'class-transformer';
import { WorkspaceHolidayResponseDto } from '../dto/calendar-response.dto';
import { CalendarCommonService } from './calendar-common.service';
import {
  CreateHolidayDto,
  UpdateHolidayDto,
  DeleteHolidayDto,
  AutoFillHolidaysDto,
} from '../dto/calendar-request.dto';

@Injectable()
export class WorkspaceHolidayService {
  private readonly logger = new Logger(WorkspaceHolidayService.name);

  constructor(
    @InjectRepository(WorkspaceHolidayEntity)
    private readonly holidayRepository: Repository<WorkspaceHolidayEntity>,
    private readonly calendarCommonService: CalendarCommonService,
    private readonly cachedService: CachedService,
  ) { }

  async getHolidays(workspaceId: string, year: number): Promise<WorkspaceHolidayResponseDto[]> {
    return this.cachedService.getOrSetList({
      trackerKey: CACHE.CALENDAR.TRACKERS.HOLIDAYS_VERSION(workspaceId),
      keyBuilder: (version) => CACHE.CALENDAR.KEYS.HOLIDAYS(workspaceId, year, version),
      ttl: TTL.WEEK,
      fetcher: async () => {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        const holidays = await this.holidayRepository.find({
          where: [
            { workspaceId, isRecurringYearly: true },
            { workspaceId, date: Between(startDate, endDate), isRecurringYearly: false }
          ],
          order: { date: 'ASC' }
        });

        return plainToInstance(WorkspaceHolidayResponseDto, holidays);
      }
    });
  }

  async createHoliday(dto: CreateHolidayDto): Promise<WorkspaceHolidayResponseDto> {
    const member = await this.calendarCommonService.fetchMember(dto.workspaceId, dto.requestorId);
    this.calendarCommonService.assertPrivileged(member.role);

    try {
      const newHoliday = this.holidayRepository.create({
        workspaceId: dto.workspaceId,
        name: dto.name,
        date: dto.date,
        isRecurringYearly: dto.isRecurringYearly ?? false,
      });

      const savedHoliday = await this.holidayRepository.save(newHoliday);
      await this.cachedService.invalidateList(CACHE.CALENDAR.TRACKERS.HOLIDAYS_VERSION(dto.workspaceId));

      return plainToInstance(WorkspaceHolidayResponseDto, savedHoliday);
    } catch (error) {
      if (error instanceof RpcException) throw error;
      if (error.code === '23505') { // Postgres unique violation
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: CALENDAR_ERROR.HOLIDAY_ALREADY_EXISTS.message,
          code: CALENDAR_ERROR.HOLIDAY_ALREADY_EXISTS.code,
        });
      }
      this.logger.error(`Error creating holiday: ${error.message}`);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: SYSTEM_ERRORS.INTERNAL_SERVER_ERROR.message,
        code: SYSTEM_ERRORS.INTERNAL_SERVER_ERROR.code,
      });
    }
  }

  async updateHoliday(dto: UpdateHolidayDto): Promise<WorkspaceHolidayResponseDto> {
    const member = await this.calendarCommonService.fetchMember(dto.workspaceId, dto.requestorId);
    this.calendarCommonService.assertPrivileged(member.role);

    const holiday = await this.holidayRepository.findOne({ where: { id: dto.id, workspaceId: dto.workspaceId } });
    if (!holiday) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        message: CALENDAR_ERROR.HOLIDAY_NOT_FOUND.message,
        code: CALENDAR_ERROR.HOLIDAY_NOT_FOUND.code,
      });
    }

    try {
      if (dto.name !== undefined) holiday.name = dto.name;
      if (dto.date !== undefined) holiday.date = dto.date;
      if (dto.isRecurringYearly !== undefined) holiday.isRecurringYearly = dto.isRecurringYearly;

      const updatedHoliday = await this.holidayRepository.save(holiday);
      await this.cachedService.invalidateList(CACHE.CALENDAR.TRACKERS.HOLIDAYS_VERSION(dto.workspaceId));

      return plainToInstance(WorkspaceHolidayResponseDto, updatedHoliday);
    } catch (error) {
      if (error instanceof RpcException) throw error;
      if (error.code === '23505') {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: CALENDAR_ERROR.HOLIDAY_ALREADY_EXISTS.message,
          code: CALENDAR_ERROR.HOLIDAY_ALREADY_EXISTS.code,
        });
      }
      this.logger.error(`Error updating holiday: ${error.message}`);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: SYSTEM_ERRORS.INTERNAL_SERVER_ERROR.message,
        code: SYSTEM_ERRORS.INTERNAL_SERVER_ERROR.code,
      });
    }
  }

  async deleteHoliday(dto: DeleteHolidayDto) {
    const member = await this.calendarCommonService.fetchMember(dto.workspaceId, dto.requestorId);
    this.calendarCommonService.assertPrivileged(member.role);

    try {
      const result = await this.holidayRepository.delete({ id: dto.id, workspaceId: dto.workspaceId });
      if (result.affected === 0) {
        throw new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          message: CALENDAR_ERROR.HOLIDAY_NOT_FOUND.message,
          code: CALENDAR_ERROR.HOLIDAY_NOT_FOUND.code,
        });
      }
      await this.cachedService.invalidateList(CACHE.CALENDAR.TRACKERS.HOLIDAYS_VERSION(dto.workspaceId));
      return { success: true };
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`Error deleting holiday: ${error.message}`);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: SYSTEM_ERRORS.INTERNAL_SERVER_ERROR.message,
        code: SYSTEM_ERRORS.INTERNAL_SERVER_ERROR.code,
      });
    }
  }

  async autoFillHolidays(dto: AutoFillHolidaysDto): Promise<WorkspaceHolidayResponseDto[]> {
    const member = await this.calendarCommonService.fetchMember(dto.workspaceId, dto.requestorId);
    this.calendarCommonService.assertPrivileged(member.role);

    try {
      const hd = new Holidays(dto.countryCode);
      const generatedHolidays = hd.getHolidays(dto.year);

      if (!generatedHolidays || generatedHolidays.length === 0) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: CALENDAR_ERROR.UNSUPPORTED_COUNTRY_HOLIDAY_AUTO_FILL.message,
          code: CALENDAR_ERROR.UNSUPPORTED_COUNTRY_HOLIDAY_AUTO_FILL.code,
        });
      }

      // Lọc ra các ngày lễ thuộc type "public" hoặc "bank" để tránh rác
      const defaultHolidays = generatedHolidays
        .filter(h => h.type === 'public' || h.type === 'bank')
        .map(h => {
          // Lấy đúng format YYYY-MM-DD (trích xuất 10 ký tự đầu của chuỗi ISO)
          const dateStr = new Date(h.date).toISOString().split('T')[0];
          return {
            name: h.name,
            date: dateStr,
            isRecurringYearly: false, // Vì date-holidays trả ra ngày cụ thể cho từng năm, ta cứ để false để dễ quản lý theo năm
          };
        });

      const existingHolidays = await this.holidayRepository.find({
        where: { workspaceId: dto.workspaceId, date: In(defaultHolidays.map(h => h.date)) },
      });
      const existingDatesSet = new Set(existingHolidays.map(h => h.date));

      const toInsert = defaultHolidays
        .filter(h => !existingDatesSet.has(h.date))
        .map(h => this.holidayRepository.create({ workspaceId: dto.workspaceId, ...h }));

      if (toInsert.length > 0) {
        await this.holidayRepository.save(toInsert);
      }

      await this.cachedService.invalidateList(CACHE.CALENDAR.TRACKERS.HOLIDAYS_VERSION(dto.workspaceId));
      return this.getHolidays(dto.workspaceId, dto.year);
    } catch (error) {
      if (error instanceof RpcException) throw error;

      this.logger.error(`Error auto-filling holidays: ${error.message}`);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: SYSTEM_ERRORS.INTERNAL_SERVER_ERROR.message,
        code: SYSTEM_ERRORS.INTERNAL_SERVER_ERROR.code,
      });
    }
  }

  async checkIfDatesAreHolidays(workspaceId: string, dates: string[]): Promise<Record<string, boolean>> {
    const years = [...new Set(dates.map(d => parseInt(d.split('-')[0], 10)))].filter(y => !isNaN(y));
    const allHolidays: WorkspaceHolidayResponseDto[] = [];
    
    for (const y of years) {
      const h = await this.getHolidays(workspaceId, y);
      allHolidays.push(...h);
    }

    const result: Record<string, boolean> = {};
    for (const checkDateStr of dates) {
      const [_, m, d] = checkDateStr.split('-');
      result[checkDateStr] = allHolidays.some(h => {
        if (h.isRecurringYearly) {
          return h.date.substring(5) === `${m}-${d}`;
        }
        return h.date === checkDateStr;
      });
    }
    
    return result;
  }
}
