const fs = require('fs');
const path = require('path');

const appsDir = path.join(__dirname, 'dist', 'apps');
let appDirs = [];

try {
  appDirs = fs.readdirSync(appsDir).filter(file => fs.statSync(path.join(appsDir, file)).isDirectory());
} catch (error) {
  console.error("Could not read apps directory:", error);
}

function getInstances(appName) {
  if (appName === 'note') return 6;
  if (appName === 'api-gateway') return 4;
  return 1;
}

module.exports = {
  apps: appDirs.map(appDir => ({
    name: appDir,
    script: `dist/apps/${appDir}/main.js`,
    instances: getInstances(appDir),
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    }
  }))
};
