import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 5);

export const generateSlug = (name: string): string => {
  const baseSlug = (name || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  return `${baseSlug}-${nanoid()}`;
};
