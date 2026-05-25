const fs = require('fs');
const path = require('path');

const appsDir = path.join(__dirname, 'dist', 'apps');
let appDirs = [];

try {
  appDirs = fs.readdirSync(appsDir).filter(file => fs.statSync(path.join(appsDir, file)).isDirectory());
} catch (error) {
  console.error("Could not read apps directory:", error);
}

module.exports = {
  apps: appDirs.map(appDir => ({
    name: appDir,
    script: `dist/apps/${appDir}/main.js`,
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    }
  }))
};
