const { join } = require('path');

// excel.worker.ts chạy trong worker_thread riêng, cần 1 file .js độc lập
// (không thể nằm trong bundle main.js) — thêm 1 entry point thứ 2.
module.exports = (options) => ({
  ...options,
  entry: {
    main: options.entry,
    'workers/excel.worker': join(__dirname, 'src/workers/excel.worker.ts'),
  },
  output: {
    ...options.output,
    filename: options.output.filename.replace(/main\.js$/, '[name].js'),
  },
});
