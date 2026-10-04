'use strict';

const { execFile } = require('child_process');

function run(file, args, { timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        err.message = `${file} ${args.join(' ')} failed: ${(stderr || stdout || err.message).toString().trim()}`;
        return reject(err);
      }
      resolve(stdout.toString());
    });
  });
}

module.exports = { run };
