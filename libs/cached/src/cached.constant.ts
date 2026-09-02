const GLOBAL_PREFIX = 'tpt';
const GLOBAL_VER = 'v1';

//Setup thời gian
export const TTL = {
  TINY: 60, // 1 phút
  SHORT: 300, // 5 phút
  MEDIUM: 3600, // 1 giờ
  LONG: 86400, // 1 ngày
  WEEK: 604800, //1 tuần
};

//Quản lý key và tag
export const CACHE = {
  AUTH: {
    _VER: 'v1',

    SETTINGS: {
      // Khung chờ (giây) sau khi 1 refresh token bị rotate: nếu chính token đó bị
      // dùng lại trong khung này (VD: 2 tab cùng đọc 1 refresh token từ localStorage
      // và cùng gọi refresh gần như đồng thời) thì trả lại đúng cặp token mới đã
      // sinh, thay vì coi là bị đánh cắp (reuse detection).
      ROTATION_GRACE_TTL: 15,
    },

    KEYS: {
      // blacklist access token
      BLACKLIST: (tokenHash: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:auth:${CACHE.AUTH._VER}:blacklist:${tokenHash}`,

      // version để logout all devices
      TOKEN_VERSION: (userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:auth:${CACHE.AUTH._VER}:version:${userId}`,

      // refresh token (optional)
      REFRESH_TOKEN: (userId: string, sessionId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:auth:${CACHE.AUTH._VER}:refresh:${userId}:${sessionId}`,

      // session (optional)
      SESSION: (userId: string, sessionId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:auth:${CACHE.AUTH._VER}:session:${userId}:${sessionId}`,

      // kết quả rotate gần nhất của 1 refresh token đã bị revoke, dùng cho grace window
      ROTATION_GRACE: (tokenHash: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:auth:${CACHE.AUTH._VER}:rotation_grace:${tokenHash}`,
    },
  },
  USER: {
    _VER: 'v1',
    KEYS: {
      LIST: (
        listVersion: number,
        limit: number,
        page: number,
        hashFilters?: string,
      ): string => {
        let key = `${GLOBAL_PREFIX}:${GLOBAL_VER}:users:${CACHE.USER._VER}:list_v${listVersion}:limit_${limit}_page_${page}`;
        if (hashFilters) {
          key = key + `_hash_${hashFilters}`;
        }
        return key;
      },
      DETAIL: (id: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:users:${CACHE.USER._VER}:detail:id_${id}`,
      TWO_FACTOR: (id: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:users:${CACHE.USER._VER}:two_factor:id_${id}`,
      PREFERENCE: (id: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:users:${CACHE.USER._VER}:preference:id_${id}`,
      SEARCH: (query: string, version: number): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:users:${CACHE.USER._VER}:search:q_${query}:v_${version}`,
    },
    TRACKERS: {
      LIST_VERSION: `${GLOBAL_PREFIX}:trackers:users:list_version`,
    },
    TAGS: {
      ROOT: (): string[] => [`${GLOBAL_PREFIX}:user`],
      DETAIL: (id: string): string[] => [`${GLOBAL_PREFIX}:user`, id],
      LIST: (): string[] => [`${GLOBAL_PREFIX}:user-list`],
    },
  },
  WORKSPACE: {
    _VER: 'v1',
    KEYS: {
      LIST: (
        listVersion: number,
        limit: number,
        page: number,
        hashFilters?: string,
      ): string => {
        let key = `${GLOBAL_PREFIX}:${GLOBAL_VER}:workspaces:${CACHE.WORKSPACE._VER}:list_v${listVersion}:limit_${limit}_page_${page}`;
        if (hashFilters) {
          key = key + `_hash_${hashFilters}`;
        }
        return key;
      },
      DETAIL: (id: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:workspaces:${CACHE.WORKSPACE._VER}:detail:id_${id}`,
      MEMBERS: (workspaceId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:workspaces:${CACHE.WORKSPACE._VER}:members:id_${workspaceId}`,
      LINKS: (workspaceId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:workspaces:${CACHE.WORKSPACE._VER}:links:id_${workspaceId}`,
      ADMINS: (workspaceId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:workspaces:${CACHE.WORKSPACE._VER}:admins:id_${workspaceId}`,
      IS_MEMBER: (workspaceId: string, userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:workspace:${workspaceId}:member:${userId}`,
    },
    TRACKERS: {
      LIST_VERSION: `${GLOBAL_PREFIX}:trackers:workspaces:list_version`,
    },
    TAGS: {
      ROOT: (): string[] => [`${GLOBAL_PREFIX}:workspace`],
      DETAIL: (id: string): string[] => [`${GLOBAL_PREFIX}:workspace`, id],
      LIST: (): string[] => [`${GLOBAL_PREFIX}:workspace-list`],
    },
  },
  USER_WORKSPACE: {
    _VER: 'v1',
    KEYS: {
      LIST: (
        userId: string,
        version: number,
        page: number,
        limit: number,
      ): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:user-workspaces:v1:user_${userId}:v_${version}:p_${page}:l_${limit}`,
    },
    TRACKERS: {
      LIST_VERSION: (userId: string): string =>
        `${GLOBAL_PREFIX}:trackers:user-workspaces:user_${userId}:version`,
    },
    TAGS: {
      ROOT: () => [`${GLOBAL_PREFIX}:user-workspaces`],
      USER: (userId: string) => [`${GLOBAL_PREFIX}:user-workspaces`, userId],
    },
  },
  CHANNEL: {
    _VER: 'v1',
    KEYS: {
      LIST: (
        workspaceId: string,
        memberId: string,
        version: number,
        page: number,
        limit: number,
        type?: string,
      ): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:channels:v1:ws_${workspaceId}:m_${memberId}:v_${version}:p_${page}:l_${limit}${type ? ':t_' + type : ''}`,
      ACCESS: (channelId: string, memberId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:channels:${CACHE.CHANNEL._VER}:access:c_${channelId}:m_${memberId}`,
      DETAIL: (id: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:channels:v1:detail:id_${id}`,
      MEMBERS: (channelId: string, version: number): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:channels:v1:members:c_${channelId}:v_${version}`,
    },
    TRACKERS: {
      LIST_VERSION: (workspaceId: string, memberId: string): string =>
        `${GLOBAL_PREFIX}:trackers:channels:ws_${workspaceId}:m_${memberId}:version`,
      MEMBERS_VERSION: (channelId: string): string =>
        `${GLOBAL_PREFIX}:trackers:channels:c_${channelId}:members_version`,
    },
  },
  TASK: {
    _VER: 'v1',
    KEYS: {
      BOARD_LIST: (
        workspaceId: string,
        memberId: string,
        version: number,
        page: number,
        limit: number,
      ): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:tasks:v1:boards:ws_${workspaceId}:m_${memberId}:v_${version}:p_${page}:l_${limit}`,
      TASK_LIST: (
        groupId: string,
        version: number,
        page: number,
        limit: number,
      ): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:tasks:v1:list:g_${groupId}:v_${version}:p_${page}:l_${limit}`,
      BOARD_DETAIL: (boardId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:tasks:v1:board:id_${boardId}`,
      BOARD_MEMBERSHIP: (boardId: string, userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:tasks:v1:board_membership:b_${boardId}:u_${userId}`,
      GROUP_DETAIL: (groupId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:tasks:v1:group:id_${groupId}`,
    },
    TRACKERS: {
      BOARD_LIST_VERSION: (workspaceId: string, memberId: string): string =>
        `${GLOBAL_PREFIX}:trackers:tasks:boards:ws_${workspaceId}:m_${memberId}:version`,
      TASK_LIST_VERSION: (groupId: string): string =>
        `${GLOBAL_PREFIX}:trackers:tasks:g_${groupId}:version`,
    },
  },
  PRESENCE: {
    _VER: 'v1',
    SETTINGS: {
      HEARTBEAT_INTERVAL: 600, // 10 phút (Thời gian client nên gửi heartbeat)
      ONLINE_THRESHOLD: 1800, // 30 phút (Quá thời gian này coi như offline)
      REDIS_TTL: 3600, // 1 giờ (Thời gian sống của key trong Redis)
    },
    KEYS: {
      USER_STATUS: (userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:presence:v1:status:${userId}`,
      USER_CONNECTIONS: (userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:presence:v1:connections:${userId}`,
    },
  },
  MESSAGE: {
    _VER: 'v1',
    KEYS: {
      PINNED_LIST: (
        channelId: string,
        version: number,
        limit: number,
        cursor?: string,
      ): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:messages:v1:pinned:c_${channelId}:v_${version}:l_${limit}${cursor ? ':cur_' + cursor : ''}`,
      LINK_PREVIEW: (b64Url: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:messages:v1:link_preview:${b64Url}`,
      // Giai đoạn 4, Step 2 — rate limit RIÊNG cho lượt trigger AI (khác rate
      // limit gửi tin nhắn thường), theo userId trong maybeTriggerAiOrchestration().
      AI_TRIGGER_RATE_LIMIT: (userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:messages:v1:rate:ai_trigger:u_${userId}`,
    },
    TRACKERS: {
      PINNED_VERSION: (channelId: string): string =>
        `${GLOBAL_PREFIX}:trackers:messages:pinned:c_${channelId}:version`,
    },
  },
  APP: {
    _VER: 'v1',
    KEYS: {
      EVENT_SUBSCRIPTIONS: (workspaceId: string, eventType: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:apps:v1:events:ws_${workspaceId}:event_${eventType}`,
      COMMAND_RESPONSE: (token: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:apps:v1:commands:response:${token}`,
      MODAL_TRIGGER: (triggerId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:apps:v1:modals:trigger:${triggerId}`,
    },
  },
  CALENDAR: {
    _VER: 'v1',
    KEYS: {
      POLICY: (workspaceId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:calendar:v1:policy:ws_${workspaceId}`,
      MEMBER: (workspaceId: string, userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:calendar:v1:member:ws_${workspaceId}:u_${userId}`,
      FACE_BASELINE: (workspaceId: string, userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:calendar:v1:face_baseline:ws_${workspaceId}:u_${userId}`,
      HOLIDAYS: (workspaceId: string, year: number, version: number): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:calendar:v1:holidays:ws_${workspaceId}:y_${year}:v_${version}`,
      RATE_LIMIT_ATTENDANCE: (workspaceId: string, userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:calendar:v1:rate:attendance:ws_${workspaceId}:u_${userId}`,
      WORKSPACE_MEMBER_STATS: (workspaceId: string, month: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:calendar:v1:stats:v2:ws_${workspaceId}:m_${month}`,
      EXPORT_JOB: (jobId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:calendar:v1:export:job_${jobId}`,
    },
    TRACKERS: {
      HOLIDAYS_VERSION: (workspaceId: string): string =>
        `${GLOBAL_PREFIX}:trackers:calendar:holidays:ws_${workspaceId}:version`,
    },
  },
  INTEGRATION: {
    _VER: 'v1',
    SETTINGS: {
      OAUTH_STATE_TTL: 900, // 15 phút — thời gian tối đa cho user hoàn thành OAuth flow
    },
    KEYS: {
      OAUTH_STATE: (stateId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:integration:v1:oauth_state:${stateId}`,
    },
  },
  ORCHESTRATION: {
    _VER: 'v1',
    SETTINGS: {
      // Turn thật hiếm khi kéo dài quá vài phút (MAX_REACT_STEPS/MAX_SUPERVISOR_ROUNDS
      // đều giới hạn số vòng) — 15 phút đủ dư để không tự xoá giữa chừng, tự dọn rác
      // nếu turn không bao giờ dọn (VD worker crash giữa chừng).
      TURN_TTL: 900,
    },
    KEYS: {
      // Ai là chủ turn (Stop/Cancel, Giai đoạn System) — messageId ở đây là
      // reply messageId của BOT, cùng ID stream token/tool-call đang dùng xuyên suốt.
      TURN_OWNER: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:turn_owner:${messageId}`,
      // Cờ báo turn cần dừng — vòng lặp đang chạy tự poll cờ này.
      TURN_CANCEL: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:turn_cancel:${messageId}`,
      CIRCUIT_BREAKER_STATE: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:state:${key}`,
      CIRCUIT_BREAKER_OPENED_AT: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:opened_at:${key}`,
      CIRCUIT_BREAKER_PROBE_LOCK: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:probe_lock:${key}`,
      CIRCUIT_BREAKER_TOTAL: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:total:${key}`,
      CIRCUIT_BREAKER_FAILURES: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:failures:${key}`,
      // Fair queueing — đếm số lần workspace trigger AI trong 1 cửa sổ trượt,
      // dùng làm priority cho job (workspace trigger dồn dập bị đẩy priority
      // tệ dần, không chặn hẳn — xem AiTriggerPriorityService).
      WORKSPACE_TRIGGER_COUNT: (workspaceId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:workspace_trigger_count:${workspaceId}`,
    },
  },
};

/*
Quy tắc TTL
1. Độ biến động dữ liệu

- Dữ liệu tĩnh: Cấu hình hệ thống, danh mục, menu, tỉnh/thành phố...
+ TTL: LONG/WEEK
+ Chiến lược: Xóa tag khi cập nhật (Hoặc dùng Tracker version)

- Dữ liệu bán tĩnh: User profile, nội dung bài viết, chi tiết sản phẩm
+ TTL: MEDIUM (1 giờ, vài giờ)
+ Chiến lược: Xóa Tag khi update

- Dữ liệu biến động cao: Giá sản phẩm, số lượng tồn kho, lượt xem
+ TTL: Tiny/Short
+ Chiến lược: Để tự cập nhật, tránh dùng Tag -> Dễ gây áp lực lên Redis

2. Phân cấp TTL

Nếu dùng Tracker Version

- List key: Nên đặt TTL ngắn (10 - 30 phút)
- Version Tracker Key: Nên đặt TTL dài hoặc không bao giờ hết hạn

Nếu dùng Cache Tags

- List key: TTL ngắn
- Detail key: TTL dài hơn
=> List key ngắn hơn Detail key

3. Không để cache hết hạn cùng lúc

const jitter = Math.floor(Math.random() * 3600) --> 0 - 5 phút

4. Hai vấn đề cache phải xử lí
- Stale Data: Dữ liệu cũ trong cache
- Cache Stampede: Nhiều request cùng lúc truy cập vào cache hết hạn
*/
