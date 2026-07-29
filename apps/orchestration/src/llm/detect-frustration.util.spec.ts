import { detectFrustration } from './detect-frustration.util';

describe('detectFrustration', () => {
  it.each([
    'sai rồi, làm lại đi',
    'ủa vẫn vậy hoài luôn',
    'lỗi nữa à',
    'lỗi tiếp nữa rồi',
    'không đúng, kiểm tra lại đi',
    'làm lại giúp tôi',
    'sao vẫn sai vậy',
    'sao cứ lỗi hoài vậy',
  ])('detects frustration in "%s"', (text) => {
    expect(detectFrustration(text)).not.toBeNull();
  });

  it.each([
    'tạo giúp tôi 1 trang Notion mới',
    'sản phẩm này giá bao nhiêu',
    'cảm ơn nhé, đúng rồi',
  ])('returns null for neutral message "%s"', (text) => {
    expect(detectFrustration(text)).toBeNull();
  });
});
