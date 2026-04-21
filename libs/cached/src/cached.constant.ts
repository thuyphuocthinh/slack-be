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
      LIST: (userId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:user-workspaces:v1:user_${userId}`,
    },
    TAGS: {
      ROOT: () => [`${GLOBAL_PREFIX}:user-workspaces`],
      USER: (userId: string) => [`${GLOBAL_PREFIX}:user-workspaces`, userId],
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
