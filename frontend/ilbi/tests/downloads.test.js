import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileReleaseURL, releaseURL, releaseSize } from '../src/utils/downloads.js';

test('release links accept HTTPS and versioned public files while rejecting executable URL schemes', () => {
  assert.equal(releaseURL('/downloads/ILBI-Setup-1.2.0-x64.exe', 'https://ilbi.uz'), 'https://ilbi.uz/downloads/ILBI-Setup-1.2.0-x64.exe');
  assert.equal(releaseURL('https://cdn.example/app.apk', 'https://ilbi.uz'), 'https://cdn.example/app.apk');
  for (const value of ['javascript:alert(1)', 'data:text/html,bad', 'https://user:secret@example.com/app.exe', '/downloads/../.env', '/downloads/%2e%2e/secret', '//evil.example/app.exe', 'http://evil.example/app.exe']) {
    assert.equal(releaseURL(value, 'https://ilbi.uz'), null);
  }
  assert.equal(releaseSize(1048576), '1.0 MB');
});

test('mobile links select official Android packages/Play and Apple stores rather than arbitrary executable files', () => {
  assert.equal(mobileReleaseURL('/downloads/mobile/' + 'a'.repeat(40) + '/ILBI-1.0.0-android-2.apk', 'https://ilbi.uz', 'android'), 'https://ilbi.uz/downloads/mobile/' + 'a'.repeat(40) + '/ILBI-1.0.0-android-2.apk');
  assert.equal(mobileReleaseURL('https://apps.apple.com/uz/app/ilbi/id123456789', 'https://ilbi.uz', 'ios'), 'https://apps.apple.com/uz/app/ilbi/id123456789');
  for (const [url, platform] of [['https://evil.example/app.apk', 'android'], ['https://play.google.com/store/apps/details?id=other.app', 'android'], ['/downloads/app.apk', 'ios'], ['javascript:bad()', 'ios']]) assert.equal(mobileReleaseURL(url, 'https://ilbi.uz', platform), null);
});

test('CI installer URLs accept an immutable commit directory and reject unsafe paths', () => {
  const commit = 'a'.repeat(40);
  const path = `/downloads/${commit}/ILBI-Setup-1.2.0-x64.exe`;
  assert.equal(releaseURL(path, 'https://ilbi.uz'), `https://ilbi.uz${path}`);
  assert.equal(releaseURL(`/downloads/mobile/${commit}/ILBI-1.0.0-android-2.apk`, 'https://ilbi.uz'), `https://ilbi.uz/downloads/mobile/${commit}/ILBI-1.0.0-android-2.apk`);
  for (const value of [`/downloads/${commit}/../.env`, '/downloads/not-a-commit/app.exe',
    `/downloads/${commit}/%2e%2e`, `/downloads/${commit}/nested/app.exe`]) {
    assert.equal(releaseURL(value, 'https://ilbi.uz'), null);
  }
});
