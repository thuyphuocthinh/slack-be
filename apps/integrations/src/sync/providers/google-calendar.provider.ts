import { Injectable, Logger } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';

@Injectable()
export class GoogleCalendarProvider {
  private readonly logger = new Logger(GoogleCalendarProvider.name);

  private getClient(accessToken: string) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  async createEvent(
    accessToken: string,
    eventId: string,
    eventParams: calendar_v3.Schema$Event,
  ): Promise<string> {
    const calendar = this.getClient(accessToken);
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        ...eventParams,
        id: eventId,
      },
    });
    return res.data.id || eventId;
  }

  async updateEvent(
    accessToken: string,
    eventId: string,
    eventParams: calendar_v3.Schema$Event,
  ): Promise<string> {
    const calendar = this.getClient(accessToken);
    const res = await calendar.events.update({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: eventParams,
    });
    return res.data.id || '';
  }

  async deleteEvent(accessToken: string, eventId: string): Promise<void> {
    const calendar = this.getClient(accessToken);
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });
  }
}
