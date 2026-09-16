// ValidationPipe (class-transformer) tạo DTO instance với MỌI field khai báo
// đều là own key — kể cả field không được gửi lên sẽ có giá trị `undefined`
// (do target ES2022+ bật useDefineForClassFields). Object.assign(entity, dto)
// vì vậy sẽ đè mất giá trị cũ của entity bằng `undefined` -> TypeORM ghi NULL
// xuống DB. Lọc field undefined trước khi assign để tránh mất dữ liệu.
export function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
