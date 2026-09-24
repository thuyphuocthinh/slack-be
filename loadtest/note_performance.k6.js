import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');
const WORKSPACE_ID = __ENV.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const TOKEN = __ENV.TOKEN;
const TEST_TYPE = (__ENV.TEST_TYPE || 'mixed').toLowerCase(); // 'read', 'write', 'mixed'
const PROFILE = (__ENV.PROFILE || 'load').toLowerCase();
const MAX_VUS = Number(__ENV.MAX_VUS || 50);
const HOLD_DURATION = __ENV.HOLD_DURATION || '1m';
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || '12s';
const PAUSE_SECONDS = Number(__ENV.PAUSE_SECONDS || 0.2);

const dbPageId = __ENV.DATABASE_PAGE_ID;
if (!dbPageId) {
  throw new Error('DATABASE_PAGE_ID is required to run the load test. Get it from the seeding output.');
}

const queryPagesDuration = new Trend('note_query_pages_duration', true);
const getPropertyValuesDuration = new Trend('note_get_property_values_duration', true);
const setPropertyValueDuration = new Trend('note_set_property_value_duration', true);
const requestFailures = new Rate('note_request_failures');
const timeoutCount = new Counter('note_timeouts');

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
    note_reads: {
      executor: 'ramping-vus',
      stages: stagesForProfile(),
      gracefulRampDown: '10s',
    },
  },
  summaryTrendStats: ['avg', 'min', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: {
    note_request_failures: ['rate<0.01'],
    note_timeouts: ['count==0'],
    note_query_pages_duration: ['p(95)<300', 'p(99)<800'],
    note_get_property_values_duration: ['p(95)<300', 'p(99)<800'],
    note_set_property_value_duration: ['p(95)<500', 'p(99)<1000'],
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
  if (!success) {
    console.error(`[${endpoint}] Failed: HTTP ${response.status} - ${response.body}`);
  }
  requestFailures.add(!success, { endpoint });
  check(response, {
    [`${endpoint}: status is 2xx`]: () => success,
    [`${endpoint}: did not time out`]: () => !timedOut,
  });
}

function queryPages(page = 1, limit = 50) {
  const url = `${BASE_URL}/workspaces/${WORKSPACE_ID}/notes/pages?parentId=${dbPageId}&page=${page}&limit=${limit}`;
  const response = http.get(url, {
    headers: headers(),
    timeout: REQUEST_TIMEOUT,
    tags: { endpoint: 'query_pages', name: 'note_query_pages' },
  });
  recordResponse(response, queryPagesDuration, 'query_pages');
  return response;
}

function getPropertyValues(rowIds) {
  if (!rowIds || rowIds.length === 0) return;
  const url = `${BASE_URL}/notes/pages/${dbPageId}/property-values?rowIds=${rowIds.join(',')}`;
  const response = http.get(url, {
    headers: headers(),
    timeout: REQUEST_TIMEOUT,
    tags: { endpoint: 'get_property_values', name: 'note_get_property_values' },
  });
  recordResponse(response, getPropertyValuesDuration, 'get_property_values');
  return response;
}

function setPropertyValue(pageId, propertyId) {
  if (!pageId || !propertyId) return;
  const url = `${BASE_URL}/notes/pages/${pageId}/property-values/${propertyId}`;
  
  // Random value payload
  const value = { text: `Updated ${Date.now()}` };

  const response = http.put(url, JSON.stringify({ value }), {
    headers: headers(),
    timeout: REQUEST_TIMEOUT,
    tags: { endpoint: 'set_property_value', name: 'note_set_property_value' },
  });
  recordResponse(response, setPropertyValueDuration, 'set_property_value');
  return response;
}

export function setup() {
  if (!TOKEN) {
    throw new Error('Missing TOKEN. Run with: k6 run -e TOKEN=<admin-access-token> ...');
  }
  if (!['read', 'write', 'mixed'].includes(TEST_TYPE)) {
    throw new Error(`Invalid TEST_TYPE=${TEST_TYPE}. Use read, write, or mixed.`);
  }

  // Fetch a list of row pages and their properties to use in write tests
  const response = queryPages(1, 100);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Setup queryPages request failed: HTTP ${response.status} ${response.body}`);
  }

  let body;
  try {
    body = response.json();
  } catch (error) {
    throw new Error(`Setup response is not JSON: ${error.message}`);
  }

  const rows = Array.isArray(body?.data) ? body.data : [];
  if (rows.length === 0) {
    throw new Error(`No rows found in database page ${dbPageId}. Run seeding first.`);
  }

  // To do a proper set property value, we need a valid propertyId.
  // We can fetch properties for the DB page.
  const propsResponse = http.get(`${BASE_URL}/notes/pages/${dbPageId}/properties`, { headers: headers() });
  const propsBody = propsResponse.json();
  const properties = Array.isArray(propsBody?.data) ? propsBody.data : [];

  return {
    rowIds: rows.map(r => r.id),
    properties: properties.map(p => p.id),
  };
}

export default function (data) {
  if (!data || !data.rowIds || data.rowIds.length === 0) {
    sleep(1);
    return;
  }

  if (TEST_TYPE === 'read') {
    queryPages(1, 50);
    // Take 20 random row IDs to query properties for
    const selectedRowIds = [];
    for (let i = 0; i < 20; i++) {
      selectedRowIds.push(data.rowIds[Math.floor(Math.random() * data.rowIds.length)]);
    }
    getPropertyValues(selectedRowIds);
  } else if (TEST_TYPE === 'write') {
    const randomRowId = data.rowIds[Math.floor(Math.random() * data.rowIds.length)];
    const randomPropId = data.properties[Math.floor(Math.random() * data.properties.length)];
    setPropertyValue(randomRowId, randomPropId);
  } else {
    const choice = Math.random();
    if (choice < 0.5) {
      queryPages(1, 50);
    } else if (choice < 0.7) {
      const selectedRowIds = [];
      for (let i = 0; i < 20; i++) {
        selectedRowIds.push(data.rowIds[Math.floor(Math.random() * data.rowIds.length)]);
      }
      getPropertyValues(selectedRowIds);
    } else {
      const randomRowId = data.rowIds[Math.floor(Math.random() * data.rowIds.length)];
      const randomPropId = data.properties[Math.floor(Math.random() * data.properties.length)];
      setPropertyValue(randomRowId, randomPropId);
    }
  }

  sleep(PAUSE_SECONDS + Math.random() * PAUSE_SECONDS);
}

export function handleSummary(data) {
  const outputFile = __ENV.SUMMARY_FILE || 'loadtest/results/note-k6-summary.json';
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
    '=== NOTE SERVICE LOAD TEST SUMMARY ===',
    `type=${TEST_TYPE} profile=${PROFILE} workspace=${WORKSPACE_ID}`,
    trendLine('note_query_pages_duration', 'query pages'),
    trendLine('note_get_property_values_duration', 'get property values'),
    trendLine('note_set_property_value_duration', 'set property value'),
    `RPS=${(metrics.http_reqs?.values?.rate || 0).toFixed(2)}`,
    `requests=${metrics.http_reqs?.values?.count || 0}`,
    `failure_rate=${((metrics.note_request_failures?.values?.rate || 0) * 100).toFixed(3)}%`,
    `timeouts=${metrics.note_timeouts?.values?.count || 0}`,
    `JSON=${outputFile}`,
    '======================================',
    '',
  ].join('\n');
  return {
    stdout: text,
    [outputFile]: JSON.stringify(data, null, 2),
  };
}
