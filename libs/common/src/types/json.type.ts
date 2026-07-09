export type StrictJsonValue = string | number | boolean | null | StrictJsonArray | StrictJsonObject;
export interface StrictJsonObject { [key: string]: StrictJsonValue }
export interface StrictJsonArray extends Array<StrictJsonValue> {}
