const path = require('path');

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(value) {
  return String(value || '').replace(ANSI_RE, '');
}

function compactMessage(error) {
  const raw = stripAnsi(error?.message || error?.value || error || 'failed');
  const lines = raw
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .filter(line => !line.trimStart().startsWith('at '));
  return lines.slice(0, 8).join('\n  ');
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath);
}

class ScreenshotReporter {
  onBegin(config, suite) {
    this.startedAt = Date.now();
    this.total = suite.allTests().length;
    this.results = new Map();
    this.failures = 0;
  }

  onTestEnd(test, result) {
    const unexpected = result.status !== test.expectedStatus;
    this.results.set(test.id, {
      status: result.status,
      expectedStatus: test.expectedStatus,
      duration: result.duration,
      unexpected,
    });

    if (!unexpected) return;

    this.failures++;
    const title = test.titlePath().filter(Boolean).join(' > ');
    const message = compactMessage(result.error || result.errors?.[0]);
    console.log(`FAIL ${title}`);
    if (message) console.log(`  ${message}`);

    for (const attachment of result.attachments || []) {
      if (!attachment.path) continue;
      const name = attachment.name || 'attachment';
      const interesting =
        attachment.contentType === 'image/png' ||
        name.toLowerCase().includes('intersection') ||
        name.toLowerCase().includes('trace');
      if (interesting) console.log(`  ${name}: ${rel(attachment.path)}`);
    }
  }

  onEnd() {
    const duration = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const entries = [...this.results.values()];
    const failed = entries.filter(result => result.unexpected).length;
    const skipped = entries.filter(result => result.status === 'skipped' && !result.unexpected).length;
    const passed = entries.length - failed - skipped;
    const skippedText = skipped ? `, skipped ${skipped}` : '';

    if (failed) {
      console.log(`FAIL ${failed}/${this.total} checks failed, passed ${passed}${skippedText} (${duration}s)`);
    } else {
      console.log(`PASS ${passed}/${this.total} checks${skippedText} (${duration}s)`);
    }
  }
}

module.exports = ScreenshotReporter;
