import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');
const WORKSPACE_ID = __ENV.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const TOKEN = __ENV.TOKEN;
const TEST_TYPE = (__ENV.TEST_TYPE || 'statistics').toLowerCase();
const PROFILE = (__ENV.PROFILE || 'load').toLowerCase();
const MAX_VUS = Number(__ENV.MAX_VUS || 50);
const HOLD_DURATION = __ENV.HOLD_DURATION || '1m';
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || '12s';
const PAUSE_SECONDS = Number(__ENV.PAUSE_SECONDS || 0.2);

const now = new Date();
const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const MONTH = __ENV.MONTH || defaultMonth;
const START_DATE = __ENV.START_DATE || `${MONTH}-01`;
const [testYear, testMonth] = MONTH.split('-').map(Number);
const lastDayOfMonth = new Date(Date.UTC(testYear, testMonth, 0)).getUTCDate();
const END_DATE =
  __ENV.END_DATE || `${MONTH}-${String(lastDayOfMonth).padStart(2, '0')}`;

const listDuration = new Trend('calendar_list_duration', true);
const detailDuration = new Trend('calendar_detail_duration', true);
const statisticsDuration = new Trend('calendar_statistics_duration', true);
const requestFailures = new Rate('calendar_request_failures');
const timeoutCount = new Counter('calendar_timeouts');

function stagesForProfile() {
  if (PROFILE === 'smoke') {
    return [
      { duration: '5s', target: 1 },
      { duration: '10s', target: 1 },
      { duration: '5s', target: 0 },
    ];
  }

  if (PROFILE === 'stress') {
    return [
      { duration: '20s', target: Math.max(1, Math.floor(MAX_VUS / 2)) },
      { duration: '30s', target: MAX_VUS },
      { duration: HOLD_DURATION, target: MAX_VUS * 2 },
      { duration: '20s', target: 0 },
    ];
  }

  return [
    { duration: '20s', target: Math.max(1, Math.floor(MAX_VUS / 2)) },
    { duration: '20s', target: MAX_VUS },
    { duration: HOLD_DURATION, target: MAX_VUS },
    { duration: '20s', target: 0 },
  ];
}

export const options = {
  scenarios: {
    calendar_reads: {
      executor: 'ramping-vus',
      stages: stagesForProfile(),
      gracefulRampDown: '10s',
    },
  },
  summaryTrendStats: ['avg', 'min', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: {
    calendar_request_failures: ['rate<0.01'],
    calendar_timeouts: ['count==0'],
    calendar_list_duration: ['p(95)<300', 'p(99)<800'],
    calendar_detail_duration: ['p(95)<300', 'p(99)<800'],
    calendar_statistics_duration: ['p(95)<1000', 'p(99)<2000'],
  },
};

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function recordResponse(response, trend, endpoint) {
  trend.add(response.timings.duration, { endpoint });

  const timedOut = response.status === 0 || response.error_code === 1050;
  if (timedOut) timeoutCount.add(1, { endpoint });

  const success = response.status >= 200 && response.status < 300;
  requestFailures.add(!success, { endpoint });
  check(response, {
    [`${endpoint}: status is 2xx`]: () => success,
    [`${endpoint}: did not time out`]: () => !timedOut,
  });
}

function listShifts() {
  const url = `${BASE_URL}/workspaces/${WORKSPACE_ID}/calendar/work-shifts` +
    `?startDate=${encodeURIComponent(START_DATE)}&endDate=${encodeURIComponent(END_DATE)}`;
  const response = http.get(url, {
    headers: headers(),
    timeout: REQUEST_TIMEOUT,
    tags: { endpoint: 'work_shifts_list', name: 'calendar_work_shifts_list' },
  });
  recordResponse(response, listDuration, 'work_shifts_list');
  return response;
}

function getShiftDetail(shiftIds) {
  if (!shiftIds.length) return;
  const shiftId = shiftIds[Math.floor(Math.random() * shiftIds.length)];
  const response = http.get(
    `${BASE_URL}/workspaces/${WORKSPACE_ID}/calendar/work-shifts/${shiftId}`,
    {
      headers: headers(),
      timeout: REQUEST_TIMEOUT,
      tags: { endpoint: 'work_shift_detail', name: 'calendar_work_shift_detail' },
    },
  );
  recordResponse(response, detailDuration, 'work_shift_detail');
}

function getWorkspaceStatistics() {
  const response = http.get(
    `${BASE_URL}/workspaces/${WORKSPACE_ID}/calendar/statistics/workspace/members` +
      `?month=${encodeURIComponent(MONTH)}`,
    {
      headers: headers(),
      timeout: REQUEST_TIMEOUT,
      tags: { endpoint: 'workspace_statistics', name: 'calendar_workspace_statistics' },
    },
  );
  recordResponse(response, statisticsDuration, 'workspace_statistics');
}

export function setup() {
  if (!TOKEN) {
    throw new Error('Missing TOKEN. Run with: k6 run -e TOKEN=<admin-access-token> ...');
  }
  if (!['list', 'detail', 'statistics', 'mixed'].includes(TEST_TYPE)) {
    throw new Error(`Invalid TEST_TYPE=${TEST_TYPE}. Use list, detail, statistics, or mixed.`);
  }

  if (TEST_TYPE === 'list' || TEST_TYPE === 'statistics') {
    return { shiftIds: [] };
  }

  const response = listShifts();
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Setup list request failed: HTTP ${response.status} ${response.body}`);
  }

  let body;
  try {
    body = response.json();
  } catch (error) {
    throw new Error(`Setup response is not JSON: ${error.message}`);
  }

  const shifts = Array.isArray(body?.data) ? body.data : [];
  if ((TEST_TYPE === 'detail' || TEST_TYPE === 'mixed') && shifts.length === 0) {
    throw new Error(`No shifts found between ${START_DATE} and ${END_DATE}; detail test cannot run.`);
  }

  return {
    shiftIds: shifts.slice(0, 1000).map((shift) => shift.id),
  };
}

export default function (data) {
  if (TEST_TYPE === 'list') {
    listShifts();
  } else if (TEST_TYPE === 'detail') {
    getShiftDetail(data.shiftIds);
  } else if (TEST_TYPE === 'statistics') {
    getWorkspaceStatistics();
  } else {
    const choice = Math.random();
    if (choice < 0.7) listShifts();
    else if (choice < 0.9) getWorkspaceStatistics();
    else getShiftDetail(data.shiftIds);
  }

  sleep(PAUSE_SECONDS + Math.random() * PAUSE_SECONDS);
}

export function handleSummary(data) {
  const outputFile = __ENV.SUMMARY_FILE || 'loadtest/results/calendar-k6-summary.json';
  const metrics = data.metrics;
  const trendLine = (name, label) => {
    const values = metrics[name]?.values;
    if (!values || !values.count) return `${label}: no samples`;
    return (
      `${label}: p50=${values['p(50)'].toFixed(2)}ms ` +
      `p95=${values['p(95)'].toFixed(2)}ms ` +
      `p99=${values['p(99)'].toFixed(2)}ms count=${values.count}`
    );
  };
  const text = [
    '',
    '=== CALENDAR LOAD TEST SUMMARY ===',
    `type=${TEST_TYPE} profile=${PROFILE} workspace=${WORKSPACE_ID}`,
    trendLine('calendar_list_duration', 'work-shifts list'),
    trendLine('calendar_detail_duration', 'work-shift detail'),
    trendLine('calendar_statistics_duration', 'workspace statistics'),
    `RPS=${(metrics.http_reqs?.values?.rate || 0).toFixed(2)}`,
    `requests=${metrics.http_reqs?.values?.count || 0}`,
    `failure_rate=${((metrics.calendar_request_failures?.values?.rate || 0) * 100).toFixed(3)}%`,
    `timeouts=${metrics.calendar_timeouts?.values?.count || 0}`,
    `JSON=${outputFile}`,
    '==================================',
    '',
  ].join('\n');
  return {
    stdout: text,
    [outputFile]: JSON.stringify(data, null, 2),
  };
}
